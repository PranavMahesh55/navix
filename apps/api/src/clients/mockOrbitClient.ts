import type {
  ArchitectureNodeType,
  NodeDetails,
  OrbitDependency,
  OrbitQueryResult,
  OrbitSymbol,
  PromptIntent
} from "@orbit-atlas/shared";
import type { OrbitClient } from "../types/orbitClient.js";

type MockFeatureGraph = {
  aliases: string[];
  symbols: OrbitSymbol[];
  dependencies: OrbitDependency[];
};

const commonLimitations = [
  "Mock data represents Orbit-style relationships for the MVP demo.",
  "Dynamic runtime behavior is not inferred unless it appears in the mocked relationships.",
  "Large repository behavior is simulated through graph ranking and node limits."
];

const symbol = (
  id: string,
  name: string,
  type: ArchitectureNodeType,
  filePath: string,
  summary: string,
  importanceScore: number,
  dependencies: string[] = [],
  relatedTests: string[] = [],
  tags: string[] = []
): OrbitSymbol => ({
  id,
  name,
  type,
  filePath,
  summary,
  importanceScore,
  dependencies,
  relatedTests,
  tags
});

const edge = (
  source: string,
  target: string,
  label: string,
  type: OrbitDependency["type"] = "dependency"
): OrbitDependency => ({
  id: `${source}->${target}:${label}`,
  source,
  target,
  label,
  type
});

const authGraph: MockFeatureGraph = {
  aliases: ["auth", "authentication", "login", "session", "token", "password"],
  symbols: [
    symbol(
      "auth.login-page",
      "LoginPage",
      "ui",
      "apps/web/src/features/auth/LoginPage.tsx",
      "Collects credentials and submits a login request through the auth API client.",
      96,
      ["auth.api-client"],
      ["auth.login-page-test"],
      ["entrypoint", "frontend"]
    ),
    symbol(
      "auth.api-client",
      "AuthApiClient",
      "api",
      "apps/web/src/api/auth.ts",
      "Wraps browser requests to the backend authentication endpoints.",
      87,
      ["auth.controller"],
      ["auth.api-client-test"],
      ["frontend", "boundary"]
    ),
    symbol(
      "auth.controller",
      "AuthController",
      "controller",
      "apps/api/src/controllers/authController.ts",
      "Validates request shape, starts the login flow, and maps service results into HTTP responses.",
      95,
      ["auth.service", "auth.rate-limit"],
      ["auth.controller-test"],
      ["backend", "entrypoint"]
    ),
    symbol(
      "auth.service",
      "AuthService",
      "service",
      "apps/api/src/services/authService.ts",
      "Coordinates credential verification, password hashing, token creation, and session persistence.",
      100,
      ["auth.user-model", "auth.password-hasher", "auth.token-service", "auth.session-store"],
      ["auth.service-test"],
      ["core", "backend"]
    ),
    symbol(
      "auth.user-model",
      "UserModel",
      "model",
      "apps/api/src/models/userModel.ts",
      "Loads users by email and exposes account status metadata used during login.",
      84,
      ["auth.user-table"],
      ["auth.user-model-test"],
      ["data-access"]
    ),
    symbol(
      "auth.user-table",
      "users table",
      "database",
      "db/schema/users.sql",
      "Stores user credentials, account status, and timestamps.",
      74,
      [],
      [],
      ["postgres"]
    ),
    symbol(
      "auth.password-hasher",
      "PasswordHasher",
      "utility",
      "apps/api/src/utils/passwordHasher.ts",
      "Compares submitted credentials with the stored password hash.",
      77,
      [],
      ["auth.password-hasher-test"],
      ["security"]
    ),
    symbol(
      "auth.token-service",
      "TokenService",
      "service",
      "apps/api/src/services/tokenService.ts",
      "Issues signed access and refresh tokens after credentials are accepted.",
      89,
      ["auth.jwt-config"],
      ["auth.token-service-test"],
      ["security"]
    ),
    symbol(
      "auth.jwt-config",
      "JWTConfig",
      "config",
      "apps/api/src/config/jwt.ts",
      "Provides token issuer, expiry, and signing key configuration.",
      61,
      [],
      [],
      ["configuration"]
    ),
    symbol(
      "auth.session-store",
      "SessionStore",
      "database",
      "apps/api/src/repositories/sessionStore.ts",
      "Persists refresh token state so sessions can be revoked.",
      71,
      [],
      ["auth.session-store-test"],
      ["persistence"]
    ),
    symbol(
      "auth.rate-limit",
      "LoginRateLimiter",
      "service",
      "apps/api/src/services/loginRateLimiter.ts",
      "Throttles repeated login attempts before they reach credential verification.",
      70,
      [],
      ["auth.rate-limit-test"],
      ["security"]
    ),
    symbol(
      "auth.service-test",
      "authService.test.ts",
      "test",
      "apps/api/src/services/authService.test.ts",
      "Covers successful login, invalid password, locked account, and token issuing failure cases.",
      69,
      ["auth.service"],
      [],
      ["test"]
    ),
    symbol(
      "auth.controller-test",
      "authController.test.ts",
      "test",
      "apps/api/src/controllers/authController.test.ts",
      "Verifies HTTP validation, response mapping, and service error handling.",
      58,
      ["auth.controller"],
      [],
      ["test"]
    ),
    symbol(
      "auth.login-page-test",
      "LoginPage.test.tsx",
      "test",
      "apps/web/src/features/auth/LoginPage.test.tsx",
      "Checks form validation, loading state, and error rendering for the login screen.",
      52,
      ["auth.login-page"],
      [],
      ["test"]
    )
  ],
  dependencies: [
    edge("auth.login-page", "auth.api-client", "submits credentials", "execution"),
    edge("auth.api-client", "auth.controller", "POST /auth/login", "execution"),
    edge("auth.controller", "auth.rate-limit", "checks attempts", "execution"),
    edge("auth.controller", "auth.service", "delegates login", "execution"),
    edge("auth.service", "auth.user-model", "loads user", "execution"),
    edge("auth.user-model", "auth.user-table", "queries", "data"),
    edge("auth.service", "auth.password-hasher", "verifies password", "execution"),
    edge("auth.service", "auth.token-service", "issues tokens", "execution"),
    edge("auth.token-service", "auth.jwt-config", "reads signing config", "dependency"),
    edge("auth.service", "auth.session-store", "stores refresh token", "data"),
    edge("auth.service-test", "auth.service", "covers", "test"),
    edge("auth.controller-test", "auth.controller", "covers", "test"),
    edge("auth.login-page-test", "auth.login-page", "covers", "test")
  ]
};

const checkoutGraph: MockFeatureGraph = {
  aliases: ["checkout", "cart", "payment", "order", "billing", "purchase"],
  symbols: [
    symbol(
      "checkout.cart-page",
      "CartPage",
      "ui",
      "apps/web/src/features/checkout/CartPage.tsx",
      "Shows cart contents and sends the user into checkout.",
      91,
      ["checkout.checkout-api"],
      ["checkout.cart-page-test"],
      ["entrypoint", "frontend"]
    ),
    symbol(
      "checkout.checkout-api",
      "CheckoutApiClient",
      "api",
      "apps/web/src/api/checkout.ts",
      "Calls backend checkout endpoints from the browser.",
      86,
      ["checkout.controller"],
      [],
      ["boundary"]
    ),
    symbol(
      "checkout.controller",
      "CheckoutController",
      "controller",
      "apps/api/src/controllers/checkoutController.ts",
      "Accepts checkout requests and converts service outcomes into HTTP responses.",
      94,
      ["checkout.service", "checkout.inventory-service"],
      ["checkout.controller-test"],
      ["backend", "entrypoint"]
    ),
    symbol(
      "checkout.service",
      "CheckoutService",
      "service",
      "apps/api/src/services/checkoutService.ts",
      "Creates orders, reserves inventory, charges payment, and emits order events.",
      100,
      ["checkout.order-model", "checkout.payment-gateway", "checkout.inventory-service", "checkout.event-bus"],
      ["checkout.service-test"],
      ["core", "backend"]
    ),
    symbol(
      "checkout.order-model",
      "OrderModel",
      "model",
      "apps/api/src/models/orderModel.ts",
      "Persists order records and status transitions.",
      83,
      ["checkout.orders-table"],
      ["checkout.order-model-test"],
      ["data-access"]
    ),
    symbol(
      "checkout.orders-table",
      "orders table",
      "database",
      "db/schema/orders.sql",
      "Stores checkout totals, payment state, and fulfillment state.",
      74,
      [],
      [],
      ["postgres"]
    ),
    symbol(
      "checkout.payment-gateway",
      "PaymentGateway",
      "external",
      "apps/api/src/clients/paymentGateway.ts",
      "Submits payment authorization requests to the configured payment processor.",
      88,
      [],
      ["checkout.payment-gateway-test"],
      ["external-api"]
    ),
    symbol(
      "checkout.inventory-service",
      "InventoryService",
      "service",
      "apps/api/src/services/inventoryService.ts",
      "Reserves stock before payment is finalized.",
      81,
      ["checkout.inventory-table"],
      ["checkout.inventory-service-test"],
      ["backend"]
    ),
    symbol(
      "checkout.inventory-table",
      "inventory table",
      "database",
      "db/schema/inventory.sql",
      "Tracks available stock and reservation counts.",
      64,
      [],
      [],
      ["postgres"]
    ),
    symbol(
      "checkout.event-bus",
      "OrderEventBus",
      "external",
      "apps/api/src/events/orderEventBus.ts",
      "Publishes checkout completion events for downstream fulfillment workflows.",
      69,
      [],
      [],
      ["messaging"]
    ),
    symbol(
      "checkout.service-test",
      "checkoutService.test.ts",
      "test",
      "apps/api/src/services/checkoutService.test.ts",
      "Covers order creation, payment failures, reservation rollback, and event emission.",
      67,
      ["checkout.service"],
      [],
      ["test"]
    ),
    symbol(
      "checkout.controller-test",
      "checkoutController.test.ts",
      "test",
      "apps/api/src/controllers/checkoutController.test.ts",
      "Verifies request validation and error response mapping.",
      53,
      ["checkout.controller"],
      [],
      ["test"]
    )
  ],
  dependencies: [
    edge("checkout.cart-page", "checkout.checkout-api", "starts checkout", "execution"),
    edge("checkout.checkout-api", "checkout.controller", "POST /checkout", "execution"),
    edge("checkout.controller", "checkout.inventory-service", "prechecks stock", "execution"),
    edge("checkout.controller", "checkout.service", "delegates purchase", "execution"),
    edge("checkout.service", "checkout.order-model", "creates order", "execution"),
    edge("checkout.order-model", "checkout.orders-table", "writes", "data"),
    edge("checkout.service", "checkout.inventory-service", "reserves stock", "execution"),
    edge("checkout.inventory-service", "checkout.inventory-table", "updates stock", "data"),
    edge("checkout.service", "checkout.payment-gateway", "authorizes payment", "external"),
    edge("checkout.service", "checkout.event-bus", "publishes event", "external"),
    edge("checkout.service-test", "checkout.service", "covers", "test"),
    edge("checkout.controller-test", "checkout.controller", "covers", "test")
  ]
};

const dependencyGraph: MockFeatureGraph = {
  aliases: ["dependency", "dependencies", "impact", "architecture", "feature", "system"],
  symbols: [
    symbol(
      "core.web-entry",
      "FeatureEntry",
      "ui",
      "apps/web/src/features/FeatureEntry.tsx",
      "Represents the browser entry point for the requested feature.",
      80,
      ["core.api-client"],
      [],
      ["entrypoint"]
    ),
    symbol(
      "core.api-client",
      "FeatureApiClient",
      "api",
      "apps/web/src/api/feature.ts",
      "Translates UI actions into backend requests.",
      76,
      ["core.controller"],
      [],
      ["boundary"]
    ),
    symbol(
      "core.controller",
      "FeatureController",
      "controller",
      "apps/api/src/controllers/featureController.ts",
      "Owns HTTP validation and response mapping for this feature.",
      86,
      ["core.service"],
      ["core.controller-test"],
      ["backend"]
    ),
    symbol(
      "core.service",
      "FeatureService",
      "service",
      "apps/api/src/services/featureService.ts",
      "Coordinates business rules and data access.",
      100,
      ["core.model", "core.policy"],
      ["core.service-test"],
      ["core"]
    ),
    symbol(
      "core.model",
      "FeatureModel",
      "model",
      "apps/api/src/models/featureModel.ts",
      "Loads and persists feature data.",
      72,
      ["core.table"],
      [],
      ["data-access"]
    ),
    symbol(
      "core.policy",
      "FeaturePolicy",
      "service",
      "apps/api/src/policies/featurePolicy.ts",
      "Applies authorization and eligibility checks.",
      70,
      [],
      ["core.policy-test"],
      ["policy"]
    ),
    symbol(
      "core.table",
      "feature table",
      "database",
      "db/schema/feature.sql",
      "Stores feature state.",
      58,
      [],
      [],
      ["postgres"]
    ),
    symbol(
      "core.service-test",
      "featureService.test.ts",
      "test",
      "apps/api/src/services/featureService.test.ts",
      "Covers the core service decisions for the requested feature.",
      61,
      ["core.service"],
      [],
      ["test"]
    ),
    symbol(
      "core.controller-test",
      "featureController.test.ts",
      "test",
      "apps/api/src/controllers/featureController.test.ts",
      "Covers controller validation and response mapping.",
      49,
      ["core.controller"],
      [],
      ["test"]
    )
  ],
  dependencies: [
    edge("core.web-entry", "core.api-client", "calls", "execution"),
    edge("core.api-client", "core.controller", "HTTP request", "execution"),
    edge("core.controller", "core.service", "delegates", "execution"),
    edge("core.service", "core.model", "loads data", "execution"),
    edge("core.service", "core.policy", "checks policy", "execution"),
    edge("core.model", "core.table", "reads/writes", "data"),
    edge("core.service-test", "core.service", "covers", "test"),
    edge("core.controller-test", "core.controller", "covers", "test")
  ]
};

const graphs = [authGraph, checkoutGraph, dependencyGraph];

const allSymbols = new Map<string, OrbitSymbol>();
const allEdges: OrbitDependency[] = [];

for (const graph of graphs) {
  for (const item of graph.symbols) {
    allSymbols.set(item.id, item);
  }
  allEdges.push(...graph.dependencies);
}

const toNodePreview = (item: OrbitSymbol) => ({
  id: item.id,
  label: item.name,
  type: item.type,
  filePath: item.filePath,
  summary: item.summary,
  importanceScore: item.importanceScore,
  dependencies: item.dependencies,
  relatedTests: item.relatedTests,
  tags: item.tags
});

export class MockOrbitClient implements OrbitClient {
  async queryArchitecture(input: PromptIntent, repoUrl?: string): Promise<OrbitQueryResult> {
    const graph = this.findGraph(input.feature, input.rawPrompt);

    return {
      provider: "mock-orbit",
      repoUrl,
      feature: input.feature,
      intent: input.intent,
      symbols: graph.symbols,
      dependencies: graph.dependencies,
      limitations: commonLimitations
    };
  }

  async expandNode(
    nodeId: string,
    input: PromptIntent,
    repoUrl?: string,
    currentNodeIds: string[] = []
  ): Promise<OrbitQueryResult> {
    const graph = this.findGraph(input.feature, input.rawPrompt);
    const neighborIds = new Set<string>([nodeId]);

    for (const item of graph.dependencies) {
      if (item.source === nodeId) {
        neighborIds.add(item.target);
      }
      if (item.target === nodeId) {
        neighborIds.add(item.source);
      }
    }

    const currentIds = new Set(currentNodeIds);
    const expandedSymbols = graph.symbols.filter((item) => {
      return neighborIds.has(item.id) || !currentIds.has(item.id);
    });

    const expandedIds = new Set(expandedSymbols.map((item) => item.id));
    const expandedDependencies = graph.dependencies.filter((item) => {
      return expandedIds.has(item.source) && expandedIds.has(item.target);
    });

    return {
      provider: "mock-orbit",
      repoUrl,
      feature: input.feature,
      intent: input.intent,
      symbols: expandedSymbols,
      dependencies: expandedDependencies,
      limitations: commonLimitations
    };
  }

  async getNodeDetails(nodeId: string): Promise<NodeDetails | undefined> {
    const item = allSymbols.get(nodeId);
    if (!item) {
      return undefined;
    }

    const outgoing = allEdges.filter((edgeItem) => edgeItem.source === nodeId);
    const incoming = allEdges.filter((edgeItem) => edgeItem.target === nodeId);

    const dependencies = outgoing
      .map((edgeItem) => allSymbols.get(edgeItem.target))
      .filter((value): value is OrbitSymbol => Boolean(value))
      .map(toNodePreview);

    const dependents = incoming
      .map((edgeItem) => allSymbols.get(edgeItem.source))
      .filter((value): value is OrbitSymbol => Boolean(value))
      .map(toNodePreview);

    const relatedTests = (item.relatedTests ?? [])
      .map((testId) => allSymbols.get(testId))
      .filter((value): value is OrbitSymbol => Boolean(value))
      .map(toNodePreview);

    return {
      id: item.id,
      label: item.name,
      type: item.type,
      filePath: item.filePath,
      summary: item.summary,
      purpose: item.summary,
      dependencies,
      dependents,
      relatedTests,
      tags: item.tags ?? []
    };
  }

  private findGraph(feature: string, rawPrompt: string): MockFeatureGraph {
    const query = `${feature} ${rawPrompt}`.toLowerCase();
    return (
      graphs.find((graph) => graph.aliases.some((alias) => query.includes(alias))) ??
      dependencyGraph
    );
  }
}
