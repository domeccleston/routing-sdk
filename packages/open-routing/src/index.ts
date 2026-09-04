import {
  createRouter as createCoreRouter,
  type RouterConfig as CoreRouterConfig,
  type FormSchema,
} from "@open-routing/core";
import { sqliteStore } from "@open-routing/store-sqlite";

export * from "@open-routing/core";

export type RouterConfig<Schema extends FormSchema> = Omit<CoreRouterConfig<Schema>, "store"> &
  (
    | { database?: string; store?: never }
    | { database?: never; store: CoreRouterConfig<Schema>["store"] }
  );

/** Persistent SQLite by default. Caller-supplied stores remain caller-owned. */
export function createRouter<const Schema extends FormSchema>(config: RouterConfig<Schema>) {
  if (config.database !== undefined && config.store !== undefined)
    throw new Error("Specify database or store, not both");
  const ownedStore =
    config.store === undefined
      ? sqliteStore(config.database ?? ".data/routing.sqlite", config.schema)
      : undefined;
  try {
    const router = createCoreRouter({ ...config, store: config.store ?? ownedStore! });
    let closed = false;
    return {
      ...router,
      async close() {
        if (closed) return;
        ownedStore?.close();
        closed = true;
      },
    };
  } catch (error) {
    ownedStore?.close();
    throw error;
  }
}

export type Router<Schema extends FormSchema> = ReturnType<typeof createRouter<Schema>>;
