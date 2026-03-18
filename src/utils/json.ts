/**
 * Utility functions for JSON manipulation.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Recursively truncates long strings within a JSON object/array,
 * preserving the overall structure and non-string values.
 *
 * @param jsonValue The value to truncate.
 * @param limit The maximum length of any string.
 * @returns A deep copy of the JSON with truncated strings.
 */
export function truncateJsonStrings(jsonValue: JsonValue, limit: number): JsonValue {
    if (typeof jsonValue === 'string') {
        if (jsonValue.length > limit) {
            return jsonValue.substring(0, limit) + `... [Truncated ${jsonValue.length - limit} characters]`;
        }
        return jsonValue;
    }
    
    if (Array.isArray(jsonValue)) {
        return jsonValue.map(item => truncateJsonStrings(item, limit));
    }
    
    if (jsonValue !== null && typeof jsonValue === 'object') {
        const result: { [key: string]: JsonValue } = {};
        for (const key of Object.keys(jsonValue)) {
            result[key] = truncateJsonStrings(jsonValue[key] as JsonValue, limit);
        }
        return result;
    }
    
    return jsonValue;
}
