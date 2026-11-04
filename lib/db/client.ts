// Neon PostgreSQL data-access client.
//
// The application was written against the Supabase (PostgREST) query builder:
// `db.from(t).select(cols).eq(...).maybeSingle()` returning `{ data, error }`.
// Rather than rewrite 141 call sites, this module implements the exact subset
// the codebase uses on top of parameterized SQL. Every call site keeps its
// shape, error handling, filtering and ownership semantics.
//
// Supported: select/insert/update/delete/upsert, eq/neq/gt/gte/lt/lte/in/
// ilike/is, JSON-path filters (data->>key), order/limit, single/maybeSingle,
// `{ onConflict }`, and rpc(). Deliberately NOT supported: embedded resources
// (joins), aggregates, count options — none are used, and silently accepting
// them would be a trap.

import { getPool, type DbError } from './pool';

export type { DbError };

// Row payloads are intentionally `any`: the previous Supabase client was used
// without generated table types, so call sites already treat rows as untyped.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Mode = 'many' | 'single' | 'maybeSingle';
type Operation = 'select' | 'insert' | 'update' | 'delete' | 'upsert';
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'ilike' | 'is';

interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}

/** Multi-row result: `data` is an array, matching PostgREST. */
export interface RowsResult<T = any> {
  data: T[] | null;
  error: DbError | null;
}

/** Single-row result from `.single()` / `.maybeSingle()`. */
export interface RowResult<T = any> {
  data: T | null;
  error: DbError | null;
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Identifiers come from source code, but validate anyway: they are interpolated. */
function ident(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Refusing to build SQL with an invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Supports `column` plus the PostgREST JSON paths used in this codebase
 * (`data->>stage`, `data->stage`). Keys are validated, so nothing reaches SQL
 * that is not a simple identifier.
 */
function columnExpression(expression: string): string {
  const trimmed = expression.trim();

  const textPath = trimmed.split('->>');
  if (textPath.length === 2) {
    return `${ident(textPath[0])}->>${jsonKey(textPath[1])}`;
  }

  const jsonPath = trimmed.split('->');
  if (jsonPath.length === 2) {
    return `${ident(jsonPath[0])}->${jsonKey(jsonPath[1])}`;
  }

  return ident(trimmed);
}

function jsonKey(key: string): string {
  const trimmed = key.trim();
  if (!IDENTIFIER.test(trimmed)) {
    throw new Error(`Refusing to build SQL with an invalid JSON key: ${key}`);
  }
  return `'${trimmed}'`;
}

function columnList(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed === '' || trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((part) => ident(part.trim()))
    .join(', ');
}

function mapError(error: unknown): DbError {
  const err = error as { message?: string; code?: string; details?: string; hint?: string };
  return {
    message: err?.message || 'Database query failed',
    code: err?.code,
    details: err?.details,
    hint: err?.hint,
  };
}

export class QueryBuilder<T = any> implements PromiseLike<RowsResult<T>> {
  private operation: Operation = 'select';
  private selection = '*';
  private returning = false;
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private payload: any = null;
  private onConflict: string | null = null;

  constructor(private readonly table: string) {}

  // ---- projection -------------------------------------------------------

  select(spec = '*'): this {
    this.selection = spec;
    this.returning = true;
    return this;
  }

  // ---- writes -----------------------------------------------------------

  insert(payload: any): this {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: any): this {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.operation = 'delete';
    return this;
  }

  upsert(payload: any, options: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.operation = 'upsert';
    this.payload = payload;
    this.onConflict = options.onConflict ?? null;
    return this;
  }

  // ---- filters ----------------------------------------------------------

  /** PostgREST-style generic filter, including JSON paths such as `data->>stage`. */
  filter(column: string, op: FilterOp, value: unknown): this {
    this.filters.push({ column, op, value });
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.filter(column, 'eq', value);
  }

  neq(column: string, value: unknown): this {
    return this.filter(column, 'neq', value);
  }

  gt(column: string, value: unknown): this {
    return this.filter(column, 'gt', value);
  }

  gte(column: string, value: unknown): this {
    return this.filter(column, 'gte', value);
  }

  lt(column: string, value: unknown): this {
    return this.filter(column, 'lt', value);
  }

  lte(column: string, value: unknown): this {
    return this.filter(column, 'lte', value);
  }

  in(column: string, values: unknown[]): this {
    return this.filter(column, 'in', values);
  }

  ilike(column: string, pattern: string): this {
    return this.filter(column, 'ilike', pattern);
  }

  is(column: string, value: null | boolean): this {
    return this.filter(column, 'is', value);
  }

  // ---- modifiers --------------------------------------------------------

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  /** Exactly one row, or a PGRST116-style error (PostgREST behaviour). */
  single(): SingleBuilder<T> {
    return new SingleBuilder<T>(this, 'single');
  }

  /** Zero or one row; `data: null` when absent (PostgREST behaviour). */
  maybeSingle(): SingleBuilder<T> {
    return new SingleBuilder<T>(this, 'maybeSingle');
  }

  // ---- SQL building (internal) -----------------------------------------

  private whereSql(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const clauses = this.filters.map((filter) => {
      const column = columnExpression(filter.column);
      const bind = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };

      switch (filter.op) {
        case 'in':
          return `${column} = ANY(${bind(filter.value)})`;
        case 'is':
          if (filter.value === null) return `${column} IS NULL`;
          if (filter.value === true) return `${column} IS TRUE`;
          if (filter.value === false) return `${column} IS FALSE`;
          throw new Error(`Unsupported IS value for ${filter.column}`);
        case 'ilike':
          return `${column} ILIKE ${bind(filter.value)}`;
        case 'eq':
          return `${column} = ${bind(filter.value)}`;
        case 'neq':
          return `${column} <> ${bind(filter.value)}`;
        case 'gt':
          return `${column} > ${bind(filter.value)}`;
        case 'gte':
          return `${column} >= ${bind(filter.value)}`;
        case 'lt':
          return `${column} < ${bind(filter.value)}`;
        case 'lte':
          return `${column} <= ${bind(filter.value)}`;
        default:
          throw new Error(`Unsupported filter operator: ${String(filter.op)}`);
      }
    });

    return ` WHERE ${clauses.join(' AND ')}`;
  }

  private assignmentsSql(params: unknown[]): string {
    const entries = Object.entries(this.payload as Record<string, unknown>).filter(
      ([, value]) => value !== undefined
    );
    if (entries.length === 0) throw new Error(`Empty update payload for ${this.table}`);
    return entries
      .map(([key, value]) => {
        params.push(value);
        return `${ident(key)} = $${params.length}`;
      })
      .join(', ');
  }

  private insertSql(params: unknown[]): string {
    const rows: Array<Record<string, unknown>> = Array.isArray(this.payload)
      ? this.payload
      : [this.payload];
    if (rows.length === 0) throw new Error(`Empty insert payload for ${this.table}`);

    const columns = [
      ...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => row[key] !== undefined))),
    ];
    if (columns.length === 0) throw new Error(`Empty insert payload for ${this.table}`);

    const tuples = rows.map((row) => {
      const placeholders = columns.map((key) => {
        params.push(row[key] === undefined ? null : row[key]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    return `INSERT INTO ${ident(this.table)} (${columns.map(ident).join(', ')}) VALUES ${tuples.join(', ')}`;
  }

  private conflictSql(): string {
    if (this.operation !== 'upsert') return '';

    const rows: Array<Record<string, unknown>> = Array.isArray(this.payload)
      ? this.payload
      : [this.payload];
    const conflictColumns = (this.onConflict ? this.onConflict.split(',') : [])
      .map((column) => column.trim())
      .filter(Boolean);

    // Without an explicit target, let Postgres infer the primary key.
    const target = conflictColumns.length ? ` (${conflictColumns.map(ident).join(', ')})` : '';

    const first = rows[0] || {};
    const updatable = Object.keys(first).filter(
      (key) => !conflictColumns.includes(key) && first[key] !== undefined
    );
    if (updatable.length === 0) return ` ON CONFLICT${target} DO NOTHING`;

    return ` ON CONFLICT${target} DO UPDATE SET ${updatable
      .map((key) => `${ident(key)} = EXCLUDED.${ident(key)}`)
      .join(', ')}`;
  }

  private build(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const table = ident(this.table);

    if (this.operation === 'select') {
      let sql = `SELECT ${columnList(this.selection)} FROM ${table}${this.whereSql(params)}`;
      if (this.orders.length) {
        sql += ` ORDER BY ${this.orders
          .map((order) => `${ident(order.column)} ${order.ascending ? 'ASC' : 'DESC'}`)
          .join(', ')}`;
      }
      if (this.limitCount !== null) sql += ` LIMIT ${Math.max(0, Math.trunc(this.limitCount))}`;
      return { sql, params };
    }

    if (this.operation === 'update') {
      return {
        sql: `UPDATE ${table} SET ${this.assignmentsSql(params)}${this.whereSql(params)}${
          this.returning ? ' RETURNING *' : ''
        }`,
        params,
      };
    }

    if (this.operation === 'delete') {
      return {
        sql: `DELETE FROM ${table}${this.whereSql(params)}${this.returning ? ' RETURNING *' : ''}`,
        params,
      };
    }

    return {
      sql: `${this.insertSql(params)}${this.conflictSql()}${this.returning ? ' RETURNING *' : ''}`,
      params,
    };
  }

  /** @internal shared with SingleBuilder */
  async run<TMode extends Mode>(mode: TMode): Promise<RowResult<T> | RowsResult<T>> {
    let sql: string;
    let params: unknown[];
    try {
      ({ sql, params } = this.build());
    } catch (error) {
      return { data: null, error: mapError(error) };
    }

    try {
      const result = await getPool().query(sql, params);
      const rows = result.rows as T[];

      if (mode === 'single') {
        if (rows.length !== 1) {
          return {
            data: null,
            error: {
              code: 'PGRST116',
              message: `Expected exactly one row from ${this.table}, received ${rows.length}`,
            },
          };
        }
        return { data: rows[0], error: null };
      }

      if (mode === 'maybeSingle') {
        if (rows.length > 1) {
          return {
            data: null,
            error: {
              code: 'PGRST116',
              message: `Expected at most one row from ${this.table}, received ${rows.length}`,
            },
          };
        }
        return { data: rows[0] ?? null, error: null };
      }

      // PostgREST only returns rows for a write when `.select()` was chained.
      const isWrite = this.operation !== 'select';
      return { data: (isWrite && !this.returning ? null : rows) as T[], error: null };
    } catch (error) {
      return { data: null, error: mapError(error) };
    }
  }

  then<TResult1 = RowsResult<T>, TResult2 = never>(
    onfulfilled?: ((value: RowsResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.run('many').then(
      (result) => result as RowsResult<T>,
      onrejected as never
    ).then(onfulfilled as never, onrejected as never) as PromiseLike<TResult1 | TResult2>;
  }
}

/** Terminal `{ data: row | null }` result for `.single()` / `.maybeSingle()`. */
export class SingleBuilder<T = any> implements PromiseLike<RowResult<T>> {
  constructor(
    private readonly builder: QueryBuilder<T>,
    private readonly mode: 'single' | 'maybeSingle'
  ) {}

  then<TResult1 = RowResult<T>, TResult2 = never>(
    onfulfilled?: ((value: RowResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.builder
      .run(this.mode)
      .then((result) => result as RowResult<T>)
      .then(onfulfilled, onrejected);
  }
}

export interface DbClient {
  from<T = any>(table: string): QueryBuilder<T>;
  rpc(name: string, args?: Record<string, unknown>): Promise<RowResult<any>>;
}

/** Creates a client bound to the shared Neon pool. */
export function createDbClient(): DbClient {
  return {
    from<T = any>(table: string) {
      if (!IDENTIFIER.test(table)) {
        throw new Error(`Refusing to build SQL with an invalid table name: ${table}`);
      }
      return new QueryBuilder<T>(table);
    },

    async rpc(name: string, args: Record<string, unknown> = {}) {
      if (!IDENTIFIER.test(name)) {
        return { data: null, error: { message: `Invalid function name: ${name}` } };
      }

      const params: unknown[] = [];
      const callArgs = Object.entries(args)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
          if (!IDENTIFIER.test(key)) throw new Error(`Invalid argument name: ${key}`);
          params.push(value);
          return `${ident(key)} => $${params.length}`;
        })
        .join(', ');

      const sql = `SELECT ${ident('public')}.${ident(name)}(${callArgs}) AS result`;
      try {
        const result = await getPool().query(sql, params);
        return { data: (result.rows[0]?.result ?? null) as any, error: null };
      } catch (error) {
        return { data: null, error: mapError(error) };
      }
    },
  };
}
