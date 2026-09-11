/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lightweight compatibility stub for legacy components (storage, avatars, etc.)
 * Notice: @supabase/supabase-js has been removed. All core product data and chat
 * services now communicate directly with App API / BFF.
 */

interface StorageBucket {
  upload: (path: string, file: any, options?: any) => Promise<{ data: any; error: any }>;
  remove: (paths: string[]) => Promise<{ data: any; error: any }>;
  createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null; error: any }>;
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
}

interface QueryBuilder {
  select: (...args: any[]) => QueryBuilder;
  insert: (...args: any[]) => QueryBuilder;
  update: (...args: any[]) => QueryBuilder;
  delete: (...args: any[]) => QueryBuilder;
  eq: (...args: any[]) => QueryBuilder;
  neq: (...args: any[]) => QueryBuilder;
  gt: (...args: any[]) => QueryBuilder;
  lt: (...args: any[]) => QueryBuilder;
  gte: (...args: any[]) => QueryBuilder;
  lte: (...args: any[]) => QueryBuilder;
  or: (...args: any[]) => QueryBuilder;
  order: (...args: any[]) => QueryBuilder;
  limit: (...args: any[]) => QueryBuilder;
  range: (...args: any[]) => QueryBuilder;
  single: () => Promise<{ data: any; error: any }>;
  then: <TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any[]; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;
}

const createQueryBuilder = (): QueryBuilder => {
  const builder: QueryBuilder = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    neq: () => builder,
    gt: () => builder,
    lt: () => builder,
    gte: () => builder,
    lte: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    single: async () => ({ data: null, error: null }),
    then: (onfulfilled, onrejected) =>
      Promise.resolve({ data: [] as any[], error: null }).then(onfulfilled, onrejected),
  };
  return builder;
};

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    refreshSession: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ data: null, error: new Error("Supabase auth deprecated") }),
    resetPasswordForEmail: async () => ({ error: null }),
    updateUser: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  storage: {
    from: (_bucket: string): StorageBucket => ({
      upload: async () => ({ data: null, error: null }),
      remove: async () => ({ data: null, error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: "" }, error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: path } }),
    }),
  },
  from: (_table: string): QueryBuilder => createQueryBuilder(),
  rpc: async (_fn: string, _args?: any) => ({ data: null, error: null }),
  functions: {
    invoke: async (_fn: string, _options?: any) => ({ data: null, error: null }),
  },
};

export default supabase;
