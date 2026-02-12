import Foundation

extension JSONDecoder.DateDecodingStrategy {
    static func format<Format: ParseStrategy>(_ format: Format) -> Self where Format: Sendable, Format.ParseInput: SendableMetatype, Format.ParseInput: Decodable, Format.ParseOutput == Date {
        .custom { decoder in
            let container = try decoder.singleValueContainer()
            let formatInput = try container.decode(Format.ParseInput.self)
            let parsed = try format.parse(formatInput)
            return parsed
        }
    }
}
