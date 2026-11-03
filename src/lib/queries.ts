import { supabase } from './supabase';
export async function fetchAll<T>(
  table: string,
  filter?: { column: string; value: string; operator?: 'eq' | 'gte' },
): Promise<T[]> {
  if (!supabase) return [];
  const result: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + 999);
    if (filter)
      query =
        filter.operator === 'gte'
          ? query.gte(filter.column, filter.value)
          : query.eq(filter.column, filter.value);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    result.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return result;
}
