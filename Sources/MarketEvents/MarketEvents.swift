import Foundation
import DiscordBM
import MongoKitten
import Logging

@main
struct MarketEvents {
    static let logger = Logger(label: "MarketEvents")
    
    private static func environmentValue(for key: UnsafePointer<CChar>) -> String? {
        guard let cString = getenv(key) else {
            return nil
        }
        return String(cString: cString)
    }
    
    private static func requiredEnvironmentValue(for key: UnsafePointer<CChar>) -> String {
        guard let value = environmentValue(for: key) else {
            fatalError("\(String(cString: key)) required")
        }
        return value
    }
    
    private static let discordCommands: [Payloads.ApplicationCommandCreate] = [
        Payloads.ApplicationCommandCreate(
            name: "ping", description: "Check that bot is responsive"
        ),
        Payloads.ApplicationCommandCreate(
            name: "earnings", description: "Company earnings events",
            options: [
                .init(type: .subCommand, name: "reminder", description: "Set a reminder for earnings", options: [
                    .init(type: .string, name: "symbol", description: "Stock ticker symbol", required: true)
                ])
            ]
        )
    ]
    
    static func main() async throws {
        let discordBotToken = requiredEnvironmentValue(for: "DISCORD_BOT_TOKEN")
        let finnhubApiKey = requiredEnvironmentValue(for: "FINNHUB_API_KEY")
        let mongoDbUri = requiredEnvironmentValue(for: "MONGO_DB_URI")
        
        let discordBot = await BotGatewayManager(token: discordBotToken, intents: [
        ])
        
        let finnhubClient = Finnhub.Client(apiKey: finnhubApiKey)
        
        let database = try await MongoDatabase.connect(to: mongoDbUri)
        let reminderStore = ReminderStore(database: database)
        
        let reminderScheduler = ReminderScheduler(reminderStore: reminderStore, discordClient: discordBot.client)
        
        await withTaskGroup(of: Void.self) { taskGroup in
            taskGroup.addTask {
                do {
                    try await reminderScheduler.start()
                } catch {
                    logger.error("reminderScheduler.start()", metadata: [
                        "error": "\(error)"
                    ])
                }
            }
            
            taskGroup.addTask {
                await discordBot.connect()
                
                do {
                    // changes in global commands can take a while to become available;
                    // during development, it's often easier to test by making commands only available
                    // in a specific guild ("server"), since those become available almost immediately
                    let developmentGuildId: GuildSnowflake? = nil
                    
                    let response: DiscordClientResponse<[ApplicationCommand]>
                    if let developmentGuildId {
                        response = try await discordBot.client.bulkSetGuildApplicationCommands(guildId: developmentGuildId, payload: discordCommands)
                    } else {
                        response = try await discordBot.client.bulkSetApplicationCommands(payload: discordCommands)
                    }
                    try response.guardSuccess()
                } catch {
                    logger.error("bulkSetApplicationCommands", metadata: [
                        "error": "\(error)"
                    ])
                }
            }
            
            // we don't expect this loop to terminate (i.e. we expect it to run forever)
            for await event in await discordBot.events {
                taskGroup.addTask {
                    let handler = DiscordEventHandler(
                        client: discordBot.client,
                        event: event,
                        finnhubClient: finnhubClient,
                        reminderStore: reminderStore
                    )
                    await handler.handleAsync()
                }
            }
        }
    }
}

// common "locale" values
extension MarketEvents {
    static let newYorkTimeZone: TimeZone = .init(identifier: "America/New_York")!
    static let posixLocale: Locale = .init(identifier: "en_POSIX")
    
    static let newYorkPosixCalendar: Calendar = {
        var calendar = posixLocale.calendar
        calendar.timeZone = newYorkTimeZone
        return calendar
    }()
}

extension Calendar {
    struct ArithmeticError: Swift.Error {
    }
}
