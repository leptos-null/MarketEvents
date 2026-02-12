import Foundation
import MongoKitten
import DiscordBM

actor ReminderStore {
    private let collection: MongoCollection
    
    init(database: MongoDatabase) {
        self.collection = database["reminders"]
    }
    
    func add(_ element: Element) async throws {
        try await collection.insertEncoded(element)
    }
    
    func prune() async throws {
        let calendar = MarketEvents.newYorkPosixCalendar
        let now = Date()
        
        let today = calendar.startOfDay(for: now)
        // just to be safe, go back 1 day
        guard let dayBefore = calendar.date(byAdding: .day, value: -1, to: today) else {
            throw Calendar.ArithmeticError()
        }
        try await collection.deleteAll(where: Element.CodingKeys.earningsDate.stringValue <= dayBefore)
    }
    
    func find<Query: MongoKittenQuery>(matching query: Query) -> MappedCursor<FindQueryBuilder, Element> {
        collection.find(query, as: Element.self)
    }
    
    func update<T: Sequence>(_ elements: T) async throws where T.Element == Element {
        // I didn't find a more efficient way to do this
        for element in elements {
            try await collection.updateEncoded(where: Element.CodingKeys.id.stringValue == element.id, to: element)
        }
    }
}

extension ReminderStore {
    // if we were using an associative database, I would probably split this up into 2 tables:
    // - earnings
    //   - symbol
    //   - date
    //   - hour
    // - reminders
    //   - channel_id
    //   - symbol
    //   - created_at
    //
    // since MongoDB Atlas is not associative, I think maintaining 2 tables is
    // more error-prone, and therefore we're using a single collection here.
    nonisolated struct Element: Codable, Identifiable {
        let id: String
        
        let channelId: ChannelSnowflake
        let symbol: String
        
        let earningsDate: Date
        let earningsHour: Finnhub.CheckedMarketHour
        
        let createdAt: Date
        
        // a reminder may be sent multiple times (for example: 1 hour before, 1 day before).
        // we call each of these "times" an "instance". each "instance" has a key.
        // keys are defined by the scheduler.
        // a key must be unique within the context of a single element.
        //   for example: "1h" and "1d", for "1 hour" and "1 day" reminders respectively,
        //   are sufficient values - the values do _not_ need to provide any additional unique information
        var sentKeys: Set<String> = []
        
        enum CodingKeys: String, CodingKey {
            case id = "_id"
            
            case channelId = "channel_id"
            case symbol
            
            case earningsDate = "earnings_date"
            case earningsHour = "earnings_hour"
            
            case createdAt = "created_at"
            
            case sentKeys = "sent_keys"
        }
        
        init(channelId: ChannelSnowflake, symbol: String, earningsDate: Date, earningsHour: Finnhub.CheckedMarketHour, createdAt: Date = .init(), sentKeys: Set<String> = []) {
            // snowflakes shouldn't have `_` characters, so this shouldn't have any collisions
            let idComponents: [String] = [
                symbol,
                channelId.rawValue
            ]
            self.id = idComponents.joined(separator: "_")
            
            self.channelId = channelId
            self.symbol = symbol
            
            self.earningsDate = earningsDate
            self.earningsHour = earningsHour
            
            self.createdAt = createdAt
            
            self.sentKeys = sentKeys
        }
    }
}
