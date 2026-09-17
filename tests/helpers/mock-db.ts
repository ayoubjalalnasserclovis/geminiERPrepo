import { vi } from "vitest";
import type { Role, SessionUser } from "@/lib/auth/require";

export type MockDbState = Record<string, any[]>;

export class MockQueryBuilder {
  private tableName: string;
  private db: MockDbState;
  private filters: Array<(row: any) => boolean> = [];
  private isSingle = false;
  private isMaybeSingle = false;
  private orderField: string | null = null;
  private orderAsc = true;
  private limitCount: number | null = null;
  private updatePatch: any = null;
  private isDelete = false;

  constructor(tableName: string, db: MockDbState) {
    this.tableName = tableName;
    this.db = db;
    if (!this.db[tableName]) {
      this.db[tableName] = [];
    }
  }

  private selectFields: string = "*";

  select(fields = "*") {
    this.selectFields = fields;
    return this;
  }

  eq(field: string, val: any) {
    this.filters.push((r) => r[field] === val);
    return this;
  }

  neq(field: string, val: any) {
    this.filters.push((r) => r[field] !== val);
    return this;
  }

  is(field: string, val: any) {
    this.filters.push((r) => {
      if (val === null) {
        return r[field] === null || r[field] === undefined;
      }
      return r[field] === val;
    });
    return this;
  }

  in(field: string, vals: any[]) {
    this.filters.push((r) => Array.isArray(vals) && vals.includes(r[field]));
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field;
    this.orderAsc = options?.ascending ?? true;
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  insert(data: any) {
    const table = this.db[this.tableName];
    const items = Array.isArray(data) ? data : [data];
    const inserted = items.map((item) => ({
      id: item.id || crypto.randomUUID(),
      created_at: item.created_at || new Date().toISOString(),
      ...(this.tableName === 'projects' ? { phase: item.phase || 'onboarding' } : {}),
      ...(this.tableName === 'payment_approvals' ? { status: item.status || 'pending', finance_status: item.finance_status || 'pending', ceo_status: item.ceo_status || 'pending', final_status: item.final_status || 'pending' } : {}),
      ...(this.tableName === 'travaux_payments' || this.tableName === 'achats_payments' || this.tableName === 'payments' ? { status: item.status || 'pending' } : {}),
      ...item,
    }));
    table.push(...inserted);
    const resultObj: any = {
      data: Array.isArray(data) ? inserted : inserted[0],
      error: null,
    };
    return Object.assign(Promise.resolve(resultObj), {
      select: () => Object.assign(Promise.resolve(resultObj), {
        single: async () => ({ data: inserted[0], error: null }),
        maybeSingle: async () => ({ data: inserted[0], error: null }),
      }),
      data: resultObj.data,
      error: null,
    });
  }

  gte(field: string, val: any) {
    this.filters.push((r) => r[field] >= val);
    return this;
  }

  gt(field: string, val: any) {
    this.filters.push((r) => r[field] > val);
    return this;
  }

  lte(field: string, val: any) {
    this.filters.push((r) => r[field] <= val);
    return this;
  }

  lt(field: string, val: any) {
    this.filters.push((r) => r[field] < val);
    return this;
  }

  ilike(field: string, pattern: string) {
    const regex = new RegExp(pattern.replace(/%/g, '.*'), 'i');
    this.filters.push((r) => regex.test(String(r[field] || '')));
    return this;
  }

  like(field: string, pattern: string) {
    const regex = new RegExp(pattern.replace(/%/g, '.*'));
    this.filters.push((r) => regex.test(String(r[field] || '')));
    return this;
  }

  contains(field: string, val: any) {
    this.filters.push((r) => {
      const target = r[field];
      if (Array.isArray(target) && Array.isArray(val)) {
        return val.every((v) => target.includes(v));
      }
      return target === val;
    });
    return this;
  }

  not(field: string, operator: string, val: any) {
    if (operator === 'eq') {
      this.filters.push((r) => r[field] !== val);
    } else if (operator === 'is') {
      this.filters.push((r) => (val === null ? (r[field] !== null && r[field] !== undefined) : r[field] !== val));
    }
    return this;
  }

  or(clause: string) {
    return this;
  }

  range(from: number, to: number) {
    this.limitCount = to - from + 1;
    return this;
  }

  upsert(data: any, options?: { onConflict?: string }) {
    const table = this.db[this.tableName];
    const items = Array.isArray(data) ? data : [data];
    const conflictKeys = options?.onConflict ? options.onConflict.split(',').map((s) => s.trim()) : ['id'];

    const results: any[] = [];
    for (const item of items) {
      const existingIdx = table.findIndex((r) => conflictKeys.every((k) => r[k] !== undefined && r[k] === item[k]));
      if (existingIdx >= 0) {
        table[existingIdx] = { ...table[existingIdx], ...item, updated_at: new Date().toISOString() };
        results.push(table[existingIdx]);
      } else {
        const created = {
          id: item.id || crypto.randomUUID(),
          created_at: item.created_at || new Date().toISOString(),
          ...item,
        };
        table.push(created);
        results.push(created);
      }
    }

    const resultObj: any = {
      data: Array.isArray(data) ? results : results[0],
      error: null,
    };
    return Object.assign(Promise.resolve(resultObj), {
      select: () => Object.assign(Promise.resolve(resultObj), {
        single: async () => ({ data: results[0], error: null }),
        maybeSingle: async () => ({ data: results[0], error: null }),
      }),
      data: resultObj.data,
      error: null,
    });
  }

  update(patch: any) {
    this.updatePatch = patch;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  single() {
    this.isSingle = true;
    return this.execute();
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this.execute();
  }

  private async execute() {
    const table = this.db[this.tableName] || [];
    let rows = table.filter((r) => this.filters.every((f) => f(r)));

    if (this.updatePatch) {
      rows.forEach((r) => {
        Object.assign(r, this.updatePatch, { updated_at: new Date().toISOString() });
        if (this.tableName === 'payment_approvals') {
          if (r.ceo_status === 'approved') r.final_status = 'approved';
          else if (r.ceo_status === 'rejected' || r.finance_status === 'rejected') r.final_status = 'rejected';
          else r.final_status = 'pending';
        }
      });
      if (this.isSingle) {
        if (rows.length === 0) {
          return { data: null, error: { message: `Record not found in ${this.tableName}`, code: "PGRST116" } };
        }
        return { data: rows[0], error: null };
      }
      return { data: rows[0] || null, error: null };
    }

    if (this.isDelete) {
      const remaining = table.filter((r) => !this.filters.every((f) => f(r)));
      this.db[this.tableName] = remaining;
      return { data: rows, error: null };
    }

    if (this.selectFields && this.selectFields !== '*') {
      const relationRegex = /([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)\(([^)]+)\)/g;
      let match;
      while ((match = relationRegex.exec(this.selectFields)) !== null) {
        const alias = match[1];
        const foreignTable = match[2];
        const requestedCols = match[3].split(',').map((c) => c.trim());
        const foreignRows = this.db[foreignTable] || [];

        rows.forEach((row) => {
          if (!row[alias]) {
            const fkKey = row[`${alias}_id`] !== undefined ? `${alias}_id` : `${foreignTable.replace(/s$/, '')}_id`;
            const fkVal = row[fkKey];
            if (fkVal) {
              const matched = foreignRows.find((fr) => fr.id === fkVal);
              if (matched) {
                const sub: any = {};
                requestedCols.forEach((col) => {
                  sub[col] = matched[col];
                });
                row[alias] = sub;
              }
            }
          }
        });
      }
    }

    if (this.orderField) {
      rows.sort((a, b) => {
        const va = a[this.orderField!];
        const vb = b[this.orderField!];
        if (va < vb) return this.orderAsc ? -1 : 1;
        if (va > vb) return this.orderAsc ? 1 : -1;
        return 0;
      });
    }

    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.isSingle) {
      if (rows.length === 0) {
        return { data: null, count: 0, error: { message: `Record not found in ${this.tableName}`, code: "PGRST116" } };
      }
      return { data: rows[0], count: rows.length, error: null };
    }

    if (this.isMaybeSingle) {
      return { data: rows[0] || null, count: rows.length, error: null };
    }

    return { data: rows, count: rows.length, error: null };
  }

  then(onfulfilled?: (val: any) => any, onrejected?: (val: any) => any) {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createMockSupabase(initialState: MockDbState = {}) {
  const db: MockDbState = { ...initialState };
  return {
    db,
    from: (table: string) => new MockQueryBuilder(table, db),
    rpc: vi.fn().mockImplementation(async (fnName: string, args: any) => {
      if (fnName === 'advance_project_phase' && args?.p_project_id && args?.p_new_phase) {
        const prj = db.projects?.find((p: any) => p.id === args.p_project_id);
        if (prj) prj.phase = args.p_new_phase;
      }
      if (fnName === 'check_artisan_payment_ready' && args?.p_artisan_id) {
        const artisan = db.artisans?.find((a: any) => a.id === args.p_artisan_id);
        if (!artisan) return { data: 'Artisan introuvable', error: null };
        const missing: string[] = [];
        if (!artisan.bank_name || !String(artisan.bank_name).trim()) missing.push('bank_name');
        if (!artisan.rib || !String(artisan.rib).trim()) missing.push('rib');
        const isIndep = artisan.legal_form === 'auto_entrepreneur' || artisan.legal_form === 'personne_physique';
        if (!isIndep) {
          const docs = db.documents || [];
          const hasRibDoc = docs.some((d: any) => d.artisan_id === args.p_artisan_id && d.type === 'attestation_rib' && !d.deleted_at);
          const hasFiscale = docs.some((d: any) => d.artisan_id === args.p_artisan_id && d.type === 'attestation_regularite_fiscale' && !d.deleted_at);
          if (!hasRibDoc) missing.push('attestation_rib');
          if (!hasFiscale) missing.push('attestation_regularite_fiscale');
        }
        if (missing.length > 0) {
          return { data: `Fiche artisan incomplète pour paiement. Manquant : ${missing.join(', ')}`, error: null };
        }
        return { data: null, error: null };
      }
      return { data: { success: true, fn: fnName, args }, error: null };
    }),
    auth: {
      getUser: vi.fn().mockImplementation(async () => ({
        data: { user: { id: currentUserId, email: `${currentRole}@stoniz.co` } },
        error: null,
      })),
      admin: {
        inviteUserByEmail: vi.fn().mockResolvedValue({
          data: { user: { id: "usr-invited-1", email: "test@example.com" } },
          error: null,
        }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: "usr-invited-1", email: "test@example.com", last_sign_in_at: null } },
          error: null,
        }),
        generateLink: vi.fn().mockResolvedValue({
          data: { properties: { action_link: "https://example.com/magic-link" } },
          error: null,
        }),
      },
    },
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://example.com/file" }, error: null }),
        createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://example.com/upload", token: "tok" }, error: null }),
        upload: vi.fn().mockResolvedValue({ data: { path: "test.pdf" }, error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  };
}

let currentRole: Role = "ceo";
let currentUserId = "usr-ceo-1";

export function setMockUser(role: Role, userId = "usr-1") {
  currentRole = role;
  currentUserId = userId;
}

export function getMockUser(): SessionUser {
  return {
    id: currentUserId,
    email: `${currentRole}@stoniz.co`,
    full_name: `Test ${currentRole.toUpperCase()}`,
    role: currentRole,
    locale: "fr",
    is_active: true,
    mfa_required: false,
  };
}
