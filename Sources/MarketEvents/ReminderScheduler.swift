import Foundation
import DiscordBM
import MongoKitten
import Logging

// current schedule for each reporting hour (New York time)
//
//   before market open:
//     - 1pm the day before
//   after market close:
//     - 9am the day of
//     - 3pm the day of
//   during market hours:
//     - 1pm the day before
//     - 9am the day of
//

actor ReminderScheduler {
    private let reminderStore: ReminderStore
    private let discordClient: any DiscordClient
    private let logger: Logger
    
    private var isSending: Bool = false
    
    init(reminderStore: ReminderStore, discordClient: any DiscordClient, logger: Logger = Logger(label: "ReminderScheduler")) {
        self.reminderStore = reminderStore
        self.discordClient = discordClient
        self.logger = logger
    }
    
    func start() async throws {
        try await sendIfNeeded()
        
        // usually I would have a routine that does something like:
        //   check the upcoming reminders (from the database),
        //   calculate the instances based off of that,
        //   schedule a timer to fire approximately at that time
        // however the database contents can change, and calculating the instances is potentially expensive
        //   (mostly from needing to load the objects out of the database).
        // additionally, these reminders could be weeks apart - a timer may behave unexpectedly over such a long duration.
        //
        // instead, we'll simply schedule timers every day at the potential times we're interested in
        
        let wakeTimes = WakeTimes(start: .now)
        for date in wakeTimes {
            let waitInterval: TimeInterval = date.timeIntervalSinceNow
            
            let now: ContinuousClock.Instant = .now
            let target = now.advanced(by: Duration.seconds(waitInterval))
            try await Task.sleep(until: target)
            
            try await reminderStore.prune()
            
            try await sendIfNeeded()
        }
    }
    
    func sendIfNeeded() async throws {
        if isSending { return }
        
        isSending = true
        do {
            let stapledInstances = try await self.eligibleReminders(for: .now)
            await sendMessages(for: stapledInstances)
            isSending = false
        } catch {
            isSending = false
            throw error
        }
    }
    
    private func eligibleReminders(for date: Date) async throws -> [StapledReminderInstances] {
        let calendar = MarketEvents.newYorkPosixCalendar
        
        let startOfDay = calendar.startOfDay(for: date)
        // for simplicity, get the next 3 days
        guard let intervalEnd = calendar.date(byAdding: .day, value: 3, to: startOfDay) else {
            throw Calendar.ArithmeticError()
        }
        
        let dbEarningsDateKey = ReminderStore.Element.CodingKeys.earningsDate.stringValue
        let reminderCandidates = await reminderStore.find(
            matching: dbEarningsDateKey >= startOfDay && dbEarningsDateKey < intervalEnd
        )
        
        // to avoid requiring very precise timing, send reminders up to 100 seconds early
        let maxDate = date.addingTimeInterval(100)
        
        var collect: [StapledReminderInstances] = []
        for try await reminder in reminderCandidates {
            var stapled = reminder.stapledInstances(for: calendar)
            stapled.instances.removeAll { instance in
                reminder.sentKeys.contains(instance.key)
            }
            stapled.instances.removeAll { instance in
                instance.date > maxDate
            }
            
            if !stapled.instances.isEmpty {
                collect.append(stapled)
            }
        }
        return collect
    }
    
    private func sendMessages(for instances: [StapledReminderInstances]) async {
        let calendar = MarketEvents.newYorkPosixCalendar
        
        let channelBins: [ChannelSnowflake: [ReminderBin: [StapledReminderInstances]]] = instances.reduce(into: [:]) { partialResult, instance in
            let dateComponents = calendar.dateComponents([.year, .month, .day], from: instance.reminder.earningsDate)
            guard let year = dateComponents.year, let month = dateComponents.month, let day = dateComponents.day else {
                return // unexpected
            }
            let bin = ReminderBin(year: year, month: month, day: day, hour: instance.reminder.earningsHour)
            partialResult[instance.reminder.channelId, default: [:]][bin, default: []].append(instance)
        }
        
        await withTaskGroup(of: Void.self) { group in
            for (channelId, bins) in channelBins {
                group.addTask {
                    do {
                        try await self.sendMessage(to: channelId, bins: bins)
                    } catch {
                        self.logger.error("sendMessage(to:bins:)", metadata: [
                            "error": "\(error)"
                        ])
                    }
                }
            }
        }
    }
    
    private func sendMessage(to channelId: ChannelSnowflake, bins: [ReminderBin: [StapledReminderInstances]]) async throws {
        let datedSections: [(section: ReminderMessageSection, date: Date, hour: Finnhub.CheckedMarketHour)] = bins.compactMap { bin, instances in
            let section = ReminderMessageSection(instances: instances)
            guard let instance = instances.first else { return nil }
            return (section, instance.reminder.earningsDate, bin.hour)
        }
        
        let sortedSections = datedSections.sorted(using: [
            KeyPathComparator(\.date),
            KeyPathComparator(\.hour)
        ])
        
        let userFacingDateStyle = Date.FormatStyle(
            date: .long, time: .omitted, locale: MarketEvents.posixLocale,
            calendar: MarketEvents.newYorkPosixCalendar, timeZone: MarketEvents.newYorkTimeZone,
            capitalizationContext: .middleOfSentence
        )
        
        let symbolsFormat: ListFormatStyle<StringStyle, [String]> =
            .list(type: .and, width: .narrow)
            .locale(MarketEvents.posixLocale)
        
        let sectionContents: [String] = sortedSections.map { section, date, hour in
            var sectionMessage: String = "### "
            sectionMessage += date.formatted(userFacingDateStyle)
            switch hour {
            case .beforeMarketOpen:
                sectionMessage += " before market open"
            case .afterMarketClose:
                sectionMessage += " after market close"
            case .duringMarketHours:
                sectionMessage += " during market hours"
            }
            sectionMessage += "\n"
            
            let symbols = section.instances.map(\.reminder.symbol)
            sectionMessage += symbols.formatted(symbolsFormat)
            
            return sectionMessage
        }
        
        let message = Payloads.CreateMessage(embeds: [
            .init(title: "Earnings Reminders", description: sectionContents.joined(separator: "\n"))
        ])
        
        try await discordClient
            .createMessage(channelId: channelId, payload: message)
            .guardSuccess()
        
        let sentInstances = sortedSections.map(\.section).flatMap(\.instances)
        let taggedReminders: [ReminderStore.Element.ID: ReminderStore.Element] = sentInstances.reduce(into: [:]) { result, staple in
            let sentKeys = staple.instances.map(\.key)
            result[staple.reminder.id, default: staple.reminder].sentKeys.formUnion(sentKeys)
        }
        
        try await reminderStore.update(taggedReminders.values)
    }
}

private struct ReminderBin: Hashable {
    let year: Int
    let month: Int
    let day: Int
    
    let hour: Finnhub.CheckedMarketHour
}

private struct ReminderMessageSection {
    let instances: [StapledReminderInstances]
}

extension ReminderScheduler {
    nonisolated struct WakeTimes: Sequence, IteratorProtocol {
        let calendar = MarketEvents.newYorkPosixCalendar
        
        private var lookAhead: [Date] = []
        private var floor: Date
        
        init(start: Date) {
            self.floor = start
        }
        
        private func timesForDay(_ date: Date) -> [Date] {
            let startOfDay = calendar.startOfDay(for: date)
            
            let candidates: [Date?] = [
                // 9am
                calendar.date(bySettingHour: 9, minute: 0, second: 0, of: startOfDay),
                // 1pm
                calendar.date(bySettingHour: 13, minute: 0, second: 0, of: startOfDay),
                // 3pm
                calendar.date(bySettingHour: 15, minute: 0, second: 0, of: startOfDay),
            ]
            return candidates.compactMap(\.self)
        }
        
        mutating func next() -> Date? {
            if !lookAhead.isEmpty {
                let pop = lookAhead.removeFirst()
                floor = pop
                return pop
            }
            
            let todayCheck = timesForDay(floor)
                .drop { $0 < floor }
            
            if todayCheck.isEmpty {
                // start of day to avoid drift
                let startOfDay = calendar.startOfDay(for: floor)
                guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: startOfDay) else {
                    return nil
                }
                floor = tomorrow
                return next()
            }
            
            lookAhead = Array(todayCheck)
            return next()
        }
    }
}


struct ReminderInstance {
    let key: String
    let date: Date
}

struct StapledReminderInstances {
    let reminder: ReminderStore.Element
    
    var instances: [ReminderInstance]
}

extension ReminderStore.Element {
    func reminderInstances(for calendar: Calendar) -> [ReminderInstance] {
        // `earningsDate` is already probably startOfDay, but just to be sure
        let startOfEarningsDate = calendar.startOfDay(for: self.earningsDate)
        
        var build: [ReminderInstance] = []
        
        switch self.earningsHour {
        case .beforeMarketOpen:
            // 1pm the day before
            if let dayBefore = calendar.date(byAdding: .day, value: -1, to: startOfEarningsDate),
               let yesterdayAfternoon = calendar.date(bySettingHour: 13, minute: 0, second: 0, of: dayBefore) {
                build.append(ReminderInstance(key: "1pm-yesterday", date: yesterdayAfternoon))
            }
        case .afterMarketClose:
            // 9am the day of
            if let morning = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: startOfEarningsDate) {
                build.append(ReminderInstance(key: "9am-today", date: morning))
            }
            // 3pm the day of
            if let afternoon = calendar.date(bySettingHour: 15, minute: 0, second: 0, of: startOfEarningsDate) {
                build.append(ReminderInstance(key: "3pm-today", date: afternoon))
            }
        case .duringMarketHours:
            // 1pm the day before
            if let dayBefore = calendar.date(byAdding: .day, value: -1, to: startOfEarningsDate),
               let yesterdayAfternoon = calendar.date(bySettingHour: 13, minute: 0, second: 0, of: dayBefore) {
                build.append(ReminderInstance(key: "1pm-yesterday", date: yesterdayAfternoon))
            }
            // 9am the day of
            if let morning = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: startOfEarningsDate) {
                build.append(ReminderInstance(key: "9am-today", date: morning))
            }
        }
        
        return build
    }
    
    func stapledInstances(for calendar: Calendar) -> StapledReminderInstances {
        return .init(reminder: self, instances: self.reminderInstances(for: calendar))
    }
}
