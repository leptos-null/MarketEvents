import Foundation
import AsyncHTTPClient
import NIOHTTP1

// https://finnhub.io/docs/api/introduction
enum Finnhub {} // namespace

extension Finnhub {
    actor Client {
        private let apiKey: String
        private let httpClient: HTTPClient
        
        private let baseURL: String = "https://finnhub.io/api/v1"
        
        init(apiKey: String, httpClient: HTTPClient = .shared) {
            self.apiKey = apiKey
            self.httpClient = httpClient
        }
        
        // https://finnhub.io/docs/api/earnings-calendar
        func earningsFor(symbol: String, fromDate: Date?, toDate: Date?) async throws -> Earnings.CalendarResponse {
            guard var components = URLComponents(string: "\(baseURL)/calendar/earnings") else {
                throw URLError(.badURL)
            }
            
            let dateFormat = Date.ISO8601FormatStyle(timeZone: MarketEvents.newYorkTimeZone)
                .year()
                .month()
                .day()
            
            var queryItems: [URLQueryItem] = [
                URLQueryItem(name: "symbol", value: symbol),
            ]
            
            if let fromDate {
                queryItems.append(URLQueryItem(name: "from", value: dateFormat.format(fromDate)))
            }
            if let toDate {
                queryItems.append(URLQueryItem(name: "to", value: dateFormat.format(toDate)))
            }
            components.queryItems = queryItems
            
            guard let url = components.url else {
                throw URLError(.badURL)
            }
            
            var request = HTTPClientRequest(url: url.absoluteString)
            request.method = .GET
            request.headers.add(name: "X-Finnhub-Token", value: apiKey)
            
            let response = try await httpClient.execute(request, timeout: .seconds(30))
            
            let responseStatus = response.status
            guard (200..<400 ~= responseStatus.code) else {
                throw Error.httpStatus(responseStatus)
            }
            
            // 32kb - more than 1kb would be surprising, so this should be plenty
            let body = try await response.body.collect(upTo: 1024 * 32)
            
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .format(dateFormat)
            return try decoder.decode(Earnings.CalendarResponse.self, from: body)
        }
    }
}

extension Finnhub.Client {
    func nextEarnings(for symbol: String, after date: Date = .now) async throws -> Finnhub.Earnings.Event? {
        let calendar = MarketEvents.newYorkPosixCalendar
        
        // take the floor of `date` to allow setting reminders on the day of `date`
        let startOfDay = calendar.startOfDay(for: date)
        
        // 1 quarter
        guard let futureDate = calendar.date(byAdding: .month, value: 3, to: startOfDay) else {
            throw Calendar.ArithmeticError()
        }
        let response = try await self.earningsFor(symbol: symbol, fromDate: startOfDay, toDate: futureDate)
        
        let sorted = response.earningsCalendar
            .filter { event in
                event.date >= startOfDay
            }
            .sorted(using: KeyPathComparator(\.date))
        
        return sorted.first
    }
}

extension Finnhub.Client {
    enum Error: Swift.Error {
        case httpStatus(HTTPResponseStatus)
    }
}

extension Finnhub {
    // namespace
    enum Earnings {
        struct Event: Codable {
            struct Hour: Codable, RawRepresentable, Hashable {
                let rawValue: String
                
                init(rawValue: String) {
                    self.rawValue = rawValue
                }
                
                init(from decoder: any Decoder) throws {
                    let container = try decoder.singleValueContainer()
                    self.rawValue = try container.decode(RawValue.self)
                }
                
                func encode(to encoder: any Encoder) throws {
                    var container = encoder.singleValueContainer()
                    try container.encode(rawValue)
                }
            }
            
            let date: Date
            let epsActual: Double?
            let epsEstimate: Double?
            let hour: Hour?
            let quarter: Int?
            let revenueActual: Int64?
            let revenueEstimate: Int64?
            let symbol: String
            let year: Int?
        }
        
        struct CalendarResponse: Codable {
            let earningsCalendar: [Earnings.Event]
        }
    }
}

extension Finnhub {
    // closed-set version of `Finnhub.Earnings.Event.Hour`
    enum CheckedMarketHour: String, Codable {
        case beforeMarketOpen = "bmo"
        case afterMarketClose = "amc"
        case duringMarketHours = "dmh"
    }
}

extension Finnhub.CheckedMarketHour: Comparable {
    static func < (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.beforeMarketOpen, .beforeMarketOpen): false
        case (.beforeMarketOpen, .afterMarketClose): true
        case (.beforeMarketOpen, .duringMarketHours): true
            
        case (.afterMarketClose, .beforeMarketOpen): false
        case (.afterMarketClose, .afterMarketClose): false
        case (.afterMarketClose, .duringMarketHours): false
            
        case (.duringMarketHours, .beforeMarketOpen): false
        case (.duringMarketHours, .afterMarketClose): true
        case (.duringMarketHours, .duringMarketHours): false
        }
    }
}

extension Finnhub.Earnings.Event.Hour {
    static let beforeMarketOpen: Self = .init(rawValue: "bmo")
    static let afterMarketClose: Self = .init(rawValue: "amc")
    static let duringMarketHours: Self = .init(rawValue: "dmh")
}
