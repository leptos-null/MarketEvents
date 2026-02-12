import DiscordBM

struct DiscordEventHandler: GatewayEventHandler {
    let client: any DiscordClient
    let event: Gateway.Event
    
    let finnhubClient: Finnhub.Client
    
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
            
            // TODO: set reminder
            // TODO: message wording
            try await updateReply(.init(content: "reminder for \(symbol)"))
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
