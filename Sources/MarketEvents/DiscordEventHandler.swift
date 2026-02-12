import Foundation
import DiscordBM

struct DiscordEventHandler: GatewayEventHandler {
    let client: any DiscordClient
    let event: Gateway.Event
    
    let finnhubClient: Finnhub.Client
    let reminderStore: ReminderStore
    
    func onInteractionCreate(_ interaction: Interaction) async throws {
        let reply: (Payloads.InteractionResponse) async throws -> Void = { response in
            try await client
                .createInteractionResponse(id: interaction.id, token: interaction.token, payload: response)
                .guardSuccess()
        }
        
        guard let interactionData = interaction.data else {
            throw Error.missingData
        }
        
        let applicationCommand = try interactionData.requireApplicationCommand()
        
        switch applicationCommand.name {
        case "ping":
            try await reply(.channelMessageWithSource(.init(
                content: "pong"
            )))
        case "earnings":
            try await reply(.deferredChannelMessageWithSource())
            
            let updateReply: (Payloads.EditWebhookMessage) async throws -> Void = { update in
                try await client
                    .updateOriginalInteractionResponse(token: interaction.token, payload: update)
                    .guardSuccess()
            }
            
            guard let subcommand = applicationCommand.options?.first else {
                throw Error.unknownCommand
            }
            // currently this is the only subcommand, but there may be others later
            guard subcommand.name == "reminder" else {
                throw Error.unknownCommand
            }
            let symbolOption = try subcommand.requireOption(named: "symbol")
            let symbol = try symbolOption.requireString()
            
            let upperSymbol: String = symbol.uppercased()
            
            guard let earnings = try await finnhubClient.nextEarnings(for: upperSymbol) else {
                try await updateReply(.init(content: "No upcoming earnings found for \(upperSymbol)"))
                return
            }
            
            let userFacingDateStyle = Date.FormatStyle(
                date: .long, time: .omitted, locale: MarketEvents.posixLocale,
                calendar: MarketEvents.newYorkPosixCalendar, timeZone: MarketEvents.newYorkTimeZone,
                capitalizationContext: .middleOfSentence
            )
            
            var message = "\(earnings.symbol) reports earnings on "
            message += userFacingDateStyle.format(earnings.date)
            
            let checkedHour: Finnhub.CheckedMarketHour?
            if let uncheckedHour = earnings.hour {
                checkedHour = Finnhub.CheckedMarketHour(rawValue: uncheckedHour.rawValue)
            } else {
                checkedHour = nil
            }
            
            guard let checkedHour else {
                try await updateReply(.init(content: message, embeds: [
                    .init(description: "Report hour not found. Please check again closer to the date.", color: .yellow)
                ]))
                return
            }
            
            switch checkedHour {
            case .beforeMarketOpen:
                message += " before market open"
            case .afterMarketClose:
                message += " after market close"
            case .duringMarketHours:
                message += " during market hours"
            }
            
            guard let channelId = interaction.channel_id else {
                try await updateReply(.init(content: message, embeds: [
                    .init(description: "Requested channel not found - unable to create reminder.", color: .red)
                ]))
                return
            }
            
            let reminder = ReminderStore.Element(
                channelId: channelId,
                symbol: upperSymbol,
                earningsDate: earnings.date, earningsHour: checkedHour
            )
            
            try await reminderStore.add(reminder)
            
            message += ".\n"
            message += "I'll remind you before the report"
            
            try await updateReply(.init(content: message))
        default:
            throw Error.unknownCommand
        }
    }
}

extension DiscordEventHandler {
    enum Error: Swift.Error {
        case missingData
        case unknownCommand
    }
}
