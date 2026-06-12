// OpenAPI 3.0 specification for the Mithras public REST API v1.
// Served at GET /functions/v1/api-v1/openapi.json and rendered in the
// in-product Swagger UI at /api-docs.

export function buildOpenApiSpec(): Record<string, unknown> {
    return {
        openapi: "3.0.3",
        info: {
            title: "Mithras Threat Defence API",
            version: "1.0.0",
            description:
                "Mithras Threat Defence public REST API for customer admins, reseller partners, " +
                "and distributors. Use this API to onboard customers, deploy agents, read endpoint " +
                "posture, retrieve threats and incidents, and download monthly reports.\n\n" +
                "**Authentication** — every request requires an `Authorization: Bearer mit_live_<token>` " +
                "header. Tokens are created from `/settings/api-keys` in the Mithras console and are " +
                "scoped to the issuing organisation. Treat tokens as credentials.\n\n" +
                "**Rate limits** — the API is shared across the platform. Steady-state up to 60 " +
                "requests per minute per token is supported without throttling. Burst traffic above " +
                "this threshold is permitted in short windows.\n\n" +
                "**Versioning** — the API surface evolves additively. Breaking changes are released " +
                "as a new version path (`api-v2`) and the old surface remains available for a " +
                "minimum of twelve months.",
            contact: {
                name:  "Mithras Customer Operations",
                url:   "https://www.mithras.com.au/contact-sales",
                email: "support@mithras.com.au",
            },
            license: { name: "Proprietary", url: "https://www.mithras.com.au/terms" },
        },
        servers: [
            { url: "https://api.mithras.com.au/functions/v1/api-v1", description: "Production" },
        ],
        security: [{ bearerAuth: [] }],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "mit_live_<random>",
                    description:
                        "Bearer token issued from `/settings/api-keys`. The raw token is shown to " +
                        "the operator exactly once at creation. Store securely.",
                },
            },
            schemas: {
                Error: {
                    type: "object",
                    properties: {
                        error:   { type: "string", description: "Machine-readable error code", example: "invalid_token" },
                        message: { type: "string", description: "Human-readable detail", nullable: true },
                    },
                    required: ["error"],
                },
                Pagination: {
                    type: "object",
                    properties: {
                        total:       { type: "integer", description: "Total matching rows across all pages" },
                        limit:       { type: "integer", description: "Page size used for this response" },
                        offset:      { type: "integer", description: "Offset used for this response" },
                        next_offset: { type: "integer", nullable: true, description: "Offset for the next page, or null when exhausted" },
                    },
                },
                Organization: {
                    type: "object",
                    properties: {
                        id:                { type: "string", format: "uuid" },
                        name:              { type: "string" },
                        slug:              { type: "string" },
                        organization_type: { type: "string", enum: ["customer", "reseller", "partner", "distributor", "home_user"] },
                        is_active:         { type: "boolean" },
                        subscription_plan: { type: "string", nullable: true },
                        credit_balance:    { type: "integer", nullable: true },
                        created_at:        { type: "string", format: "date-time" },
                    },
                },
                Me: {
                    type: "object",
                    properties: {
                        api_key_id:   { type: "string", format: "uuid" },
                        scopes:       { type: "array", items: { type: "string" } },
                        organization: { $ref: "#/components/schemas/Organization" },
                    },
                },
                CustomerCreate: {
                    type: "object",
                    required: ["name"],
                    properties: {
                        name:                  { type: "string", minLength: 2, maxLength: 80, example: "Acme Manufacturing" },
                        reseller_id:           { type: "string", format: "uuid", nullable: true, description: "For distributors creating customers under a specific reseller. Defaults to the calling organisation." },
                        wholesale_price_cents: { type: "integer", minimum: 0, maximum: 100000, nullable: true, description: "Per-endpoint monthly wholesale price in cents. Omit to inherit the reseller's tier." },
                    },
                },
                Endpoint: {
                    type: "object",
                    properties: {
                        id:              { type: "string", format: "uuid" },
                        hostname:        { type: "string" },
                        runtime:         { type: "string", example: "powershell" },
                        agent_version:   { type: "string", example: "0.7.17" },
                        is_active:       { type: "boolean" },
                        enrolled_at:     { type: "string", format: "date-time" },
                        last_seen_at:    { type: "string", format: "date-time", nullable: true },
                        organization_id: { type: "string", format: "uuid" },
                    },
                },
                Incident: {
                    type: "object",
                    properties: {
                        id:                  { type: "string", format: "uuid" },
                        organization_id:     { type: "string", format: "uuid" },
                        title:               { type: "string" },
                        description:         { type: "string", nullable: true },
                        severity:            { type: "string", enum: ["Severe", "High", "Moderate", "Low"] },
                        status:              { type: "string", enum: ["open", "triaging", "in_progress", "resolved", "false_positive"] },
                        opened_at:           { type: "string", format: "date-time" },
                        sla_due_at:          { type: "string", format: "date-time" },
                        resolved_at:         { type: "string", format: "date-time", nullable: true },
                        resolution_notes:    { type: "string", nullable: true },
                        playbook_step:       { type: "string", nullable: true },
                        commander_summary:   { type: "string", nullable: true },
                        commander_kind:      { type: "string", nullable: true },
                    },
                },
                Threat: {
                    type: "object",
                    properties: {
                        id:                              { type: "string", format: "uuid" },
                        endpoint_id:                     { type: "string", format: "uuid" },
                        threat_name:                     { type: "string" },
                        severity:                        { type: "string", enum: ["Severe", "High", "Moderate", "Low"] },
                        category:                        { type: "string", example: "Malware" },
                        status:                          { type: "string", example: "active" },
                        initial_detection_time:          { type: "string", format: "date-time" },
                        last_threat_status_change_time:  { type: "string", format: "date-time", nullable: true },
                    },
                },
                Report: {
                    type: "object",
                    properties: {
                        id:              { type: "string", format: "uuid" },
                        organization_id: { type: "string", format: "uuid" },
                        period_start:    { type: "string", format: "date" },
                        period_end:      { type: "string", format: "date" },
                        status:          { type: "string", enum: ["draft", "ready", "sent"] },
                        sent_at:         { type: "string", format: "date-time", nullable: true },
                        summary:         { type: "string", nullable: true },
                    },
                },
                EnrollmentTokenRequest: {
                    type: "object",
                    properties: {
                        organization_id: { type: "string", format: "uuid", nullable: true, description: "Defaults to the calling organisation." },
                        platform:        { type: "string", enum: ["windows", "linux"], default: "windows" },
                        ttl_minutes:     { type: "integer", minimum: 60, maximum: 10080, default: 60 },
                    },
                },
                EnrollmentTokenResponse: {
                    type: "object",
                    properties: {
                        token:           { type: "string", description: "Single-use install token. Treat as a credential." },
                        expires_at:      { type: "string", format: "date-time" },
                        organization_id: { type: "string", format: "uuid" },
                        platform:        { type: "string" },
                        install_command: { type: "string", description: "Ready-to-paste install one-liner." },
                    },
                },
            },
            parameters: {
                Limit:  { in: "query", name: "limit",  schema: { type: "integer", default: 50, maximum: 200 }, description: "Page size" },
                Offset: { in: "query", name: "offset", schema: { type: "integer", default: 0,  maximum: 100000 }, description: "Page offset" },
            },
            responses: {
                Unauthorized: { description: "Missing or invalid bearer token.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                Forbidden:    { description: "Token lacks the required scope or org type.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                NotFound:     { description: "Resource does not exist or is not visible.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            },
        },
        tags: [
            { name: "Identity",   description: "Calling identity and scope." },
            { name: "Onboarding", description: "Create and list customer organisations. Reseller and distributor use." },
            { name: "Endpoints",  description: "Enrolled Windows devices reporting telemetry." },
            { name: "Incidents",  description: "AI-triaged security incidents." },
            { name: "Threats",    description: "Microsoft Defender and Mithras detections." },
            { name: "Reports",    description: "Monthly customer reports." },
            { name: "Agent",      description: "Agent installation and management." },
        ],
        paths: {
            "/me": {
                get: {
                    tags: ["Identity"],
                    summary: "Calling identity",
                    description: "Returns the organisation context and granted scopes for the presented token.",
                    responses: {
                        "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Me" } } } },
                        "401": { $ref: "#/components/responses/Unauthorized" },
                    },
                },
            },
            "/customers": {
                get: {
                    tags: ["Onboarding"],
                    summary: "List customer organisations",
                    description: "Returns customers owned by the calling reseller or, for distributors, customers across the calling distributor's reseller channel.",
                    parameters: [{ $ref: "#/components/parameters/Limit" }, { $ref: "#/components/parameters/Offset" }],
                    responses: {
                        "200": {
                            description: "OK",
                            content: { "application/json": { schema: {
                                allOf: [
                                    { $ref: "#/components/schemas/Pagination" },
                                    { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Organization" } } } },
                                ],
                            } } },
                        },
                        "401": { $ref: "#/components/responses/Unauthorized" },
                        "403": { $ref: "#/components/responses/Forbidden" },
                    },
                },
                post: {
                    tags: ["Onboarding"],
                    summary: "Create a customer organisation (onboarding)",
                    description:
                        "Onboards a new customer organisation under the calling reseller or under a " +
                        "reseller owned by the calling distributor. The customer is created with the " +
                        "default Defender policy and the default Windows Update policy attached.\n\n" +
                        "Requires the `customers:write` scope.",
                    requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CustomerCreate" } } } },
                    responses: {
                        "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Organization" } } } } } },
                        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
                        "401": { $ref: "#/components/responses/Unauthorized" },
                        "403": { $ref: "#/components/responses/Forbidden" },
                    },
                },
            },
            "/endpoints": {
                get: {
                    tags: ["Endpoints"],
                    summary: "List endpoints",
                    parameters: [
                        { $ref: "#/components/parameters/Limit" },
                        { $ref: "#/components/parameters/Offset" },
                        { in: "query", name: "organization_id", schema: { type: "string", format: "uuid" }, description: "For resellers and distributors: scope to a single customer." },
                    ],
                    responses: {
                        "200": { description: "OK", content: { "application/json": { schema: {
                            allOf: [
                                { $ref: "#/components/schemas/Pagination" },
                                { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Endpoint" } } } },
                            ],
                        } } } },
                        "401": { $ref: "#/components/responses/Unauthorized" },
                        "403": { $ref: "#/components/responses/Forbidden" },
                    },
                },
            },
            "/endpoints/{id}": {
                get: {
                    tags: ["Endpoints"],
                    summary: "Get endpoint detail",
                    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
                    responses: {
                        "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Endpoint" } } } } } },
                        "404": { $ref: "#/components/responses/NotFound" },
                        "401": { $ref: "#/components/responses/Unauthorized" },
                    },
                },
            },
            "/incidents": {
                get: {
                    tags: ["Incidents"],
                    summary: "List incidents",
                    parameters: [
                        { $ref: "#/components/parameters/Limit" },
                        { $ref: "#/components/parameters/Offset" },
                        { in: "query", name: "status", schema: { type: "string", enum: ["open", "triaging", "in_progress", "resolved", "false_positive"] } },
                    ],
                    responses: {
                        "200": { description: "OK", content: { "application/json": { schema: {
                            allOf: [
                                { $ref: "#/components/schemas/Pagination" },
                                { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Incident" } } } },
                            ],
                        } } } },
                        "401": { $ref: "#/components/responses/Unauthorized" },
                    },
                },
            },
            "/incidents/{id}": {
                get: {
                    tags: ["Incidents"],
                    summary: "Get incident detail",
                    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
                    responses: {
                        "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Incident" } } } } } },
                        "404": { $ref: "#/components/responses/NotFound" },
                    },
                },
            },
            "/threats": {
                get: {
                    tags: ["Threats"],
                    summary: "List threats",
                    parameters: [{ $ref: "#/components/parameters/Limit" }, { $ref: "#/components/parameters/Offset" }],
                    responses: {
                        "200": { description: "OK", content: { "application/json": { schema: {
                            allOf: [
                                { $ref: "#/components/schemas/Pagination" },
                                { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Threat" } } } },
                            ],
                        } } } },
                    },
                },
            },
            "/reports": {
                get: {
                    tags: ["Reports"],
                    summary: "List monthly customer reports",
                    parameters: [{ $ref: "#/components/parameters/Limit" }, { $ref: "#/components/parameters/Offset" }],
                    responses: {
                        "200": { description: "OK", content: { "application/json": { schema: {
                            allOf: [
                                { $ref: "#/components/schemas/Pagination" },
                                { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Report" } } } },
                            ],
                        } } } },
                    },
                },
            },
            "/agent/enrollment-token": {
                post: {
                    tags: ["Agent"],
                    summary: "Issue an agent enrolment token",
                    description:
                        "Generates a single-use enrolment token bound to a specific organisation. " +
                        "The token is used by the install one-liner returned in the response. The " +
                        "token can be redeemed only once and expires after `ttl_minutes`.\n\n" +
                        "Requires the `agent:enroll` scope.",
                    requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EnrollmentTokenRequest" } } } },
                    responses: {
                        "201": { description: "Issued", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/EnrollmentTokenResponse" } } } } } },
                        "400": { description: "Validation error" },
                        "401": { $ref: "#/components/responses/Unauthorized" },
                        "403": { $ref: "#/components/responses/Forbidden" },
                    },
                },
            },
        },
    };
}
