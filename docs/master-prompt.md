# KhanehYar — Master Development Prompt (Canonical)

> نسخهٔ مرجعِ «پرامپت مادرِ» توسعهٔ خانه‌یار. متنِ دست‌نخوردهٔ زیر مرجعِ حاکم است.
> ذخیره‌شده: ۱۴۰۵/۰۶/۳۱ (2026-09-22). سند همراه: `audit-2026-09-17-master-prompt.md` (ممیزیِ بند ۰).
> توجه: شماره‌گذاریِ بند/Ruleهای فایلِ ممیزی به یک پیش‌نویسِ قدیمی‌تر اشاره دارد؛ *محتوا* معتبر است، ولی *ارجاعِ شماره‌ها* را با این نسخه یکی نگیر.

> **تصمیمِ حل‌شده (۱۴۰۵/۰۶/۳۱):** تعارضِ احراز هویت به‌نفعِ سیستمِ موجود حل شد. احراز هویتِ حاکم **موبایل + رمز + OTP + Argon2id** است. عبارتِ «Google / Apple / Email» در §9.2 و §3.9 توصیفِ نادرستِ سیستمِ موجود بوده و **منسوخ** است؛ «سیستمِ واحدِ احراز هویت» یعنی همین موبایل+رمز+OTP.

> **تصمیم‌های حل‌شده (۱۴۰۵/۰۷/۰۳):**
> * **§9.3 — سوییچِ چند-خانواده منسوخ شد.** تصمیمِ قفل‌شدهٔ C1 («یک شماره = یک خانواده») حاکم است؛ مسیرِ پس از ورود دو شاخه دارد نه سه.
> * **§3.8 — قیفِ آغازین سه قدم است، نه هشت صفحه.** کدِ موجود (`welcome → value → questions`) منبعِ حقیقت است و متنِ انگلیسیِ آن بند منسوخ.
> * **ارجاعِ §3.9 وجودِ خارجی ندارد.** هر جای سند به «Section 3.9» ارجاع داده (از جمله §9.2)، ارجاعْ بی‌مقصد است؛ تا وقتی مالک متنِ آن بند را ندهد، §3.8 را مرجع بگیر.

> **تصمیمِ حل‌شده (۱۴۰۵/۰۷/۰۶):** **§9.5 بازیابیِ رمز** از «نوشته ولی ساخته‌نشده» درآمد و پیاده شد؛ یادداشتِ زیرِ همان بند می‌گوید «مسیرِ استانداردِ امن» در این مخزن دقیقاً یعنی چه (دو گام، پاسخِ یکسان برای شمارهٔ ثبت‌شده و ثبت‌نشده، کدِ هش‌شدهٔ هدف‌دار، `logout_all`، درگاهِ پیامکِ بی‌کلید-خنثی).

> **تصمیمِ حل‌شده (۱۴۰۵/۰۷/۱۱):** **§8.2 کشِ کاملِ خواندنِ آفلاین** آینده‌نگر است و امروز عمداً اجرا نمی‌شود — چون §8.3 همهٔ دادهٔ موجودِ نرم‌افزار (مالی و عضویت) را از آفلاین بیرون گذاشته، پس مجموعهٔ قابلِ کش تهی است. آفلاین = فقط پوستهٔ نرم‌افزار؛ §5.27 و §8.5 دست‌نخورده. یادداشتِ زیرِ همان بند را ببین.

> **اجرا‌شده (۱۴۰۵/۰۷/۱۱):** **§8.5** («کش هنگامِ خروج پاک می‌شود») تا امروز فقط روی کاغذ بود؛ حالا خودِ `LogoutUseCase` آن را انجام می‌دهد. **§8.6** نوارِ «اتصال نیست» گرفت — ولی بازخوردِ به‌ازای‌هر‌کنش همچنان باز است. یادداشتِ زیرِ هر دو بند را ببین.

> **تصمیمِ حل‌شده (۱۴۰۵/۰۷/۱۲) — مرحلهٔ C / §۷ اعلان:** کانال **فقط درون‌نرم‌افزاری** است و **پوش ساخته نمی‌شود** (تحویلِ نامطمئن در ایران + نبودِ زمان‌بند + قیدِ تک‌ورکر). کلیدهای §۷.۳ به **زیرصفحهٔ «اعلان‌ها» در تنظیمات** رفتند، چون هر دو ارجاعِ سند («گامِ ششمِ §۳.۸» و «گامِ Reminders Opt-Inِ §۳.۹») بی‌مقصدند. **ساعاتِ سکوت** عمداً اجرا نشد چون به‌حکمِ متنِ خودش فقط پوش را مهار می‌کند. اعلان‌ها **مشتق‌شده**اند نه ذخیره‌شده. یادداشتِ زیرِ §7.1 تا §7.4 را ببین.

> **تصمیمِ حل‌شده (۱۴۰۵/۰۷/۲۱) — §۱.۸ خرید و انبار، و شرطِ معلّقِ §۸.۲:** ماژول ساخته شد (دو موجودیت: لیستِ نام‌دار + انبارِ آستانه‌دار؛ «خرید انجام شد» یک تراکنشِ هزینه و بالابردنِ موجودی را در یک commit انجام می‌دهد؛ `InventoryBelowThreshold`ِ §۴.۹ به دامنهٔ تازهٔ `inventory` در §۷ وصل شد). **و با همین، شرطی که یادداشتِ ۱۴۰۵/۰۷/۱۱ زیرِ §۸.۲ گذاشته بود برآورده شد** — «از لحظه‌ای که ماژول‌های خانه ساخته شوند» رسید، و §۸.۳ صریحاً اقلامِ لیستِ خرید و به‌روزرسانیِ موجودی را آفلاین مجاز کرده. تصمیمِ مالک: **ماژول الان فقط آنلاین؛ لایهٔ آفلاین (کشِ خواندنِ §۸.۲ + صفِ نوشتن و نمایشِ تعارضِ §۸.۴) یک مرحلهٔ مستقلِ بعدی است.** یادداشتِ به‌روزشدهٔ زیرِ §8.2 و §8.3 را ببین.

---

## 0. PRE-IMPLEMENTATION AUDIT

Before writing or changing any code, or applying any instruction in this document, do the following, in order:

1. Check what you already know first. If you already have knowledge of the existing KhanehYar codebase, architecture, database schema, Finance module, authentication system, or onboarding flow from prior context/memory, use that directly. Do NOT re-read files or re-inspect parts of the repository you already know.
2. For anything you do not already know, inspect the actual repository (structure, modules, architecture, naming conventions, database schema, Finance implementation, authentication, onboarding flow, shared utilities, security controls).
3. Compare the current/known state against every instruction in this document — both on the logic/architecture side (product model, household/membership model, domain boundaries, cross-domain relationships, security & authorization rules) and on the design side (brand identity, colors, typography, RTL, onboarding UX).
4. If you find any conflict, gap, or ambiguity between what already exists (in code or in your known context) and what this document specifies:

```text
STOP
    ↓
Explain the conflict
    ↓
Identify affected files/modules/decisions
    ↓
Present options
    ↓
WAIT FOR APPROVAL
```

Do NOT guess, silently pick one side, or proceed past a conflict on your own judgment.

5. Only after conflicts are resolved (or you confirm there are none), proceed to implementation as described in the rest of this document.

This audit step applies to the entire document — including Section 5 (Security & Privacy). If the existing codebase already handles something (e.g. auth, encryption, household model) differently than described here, flag it rather than silently overriding, duplicating, or ignoring it.

## 1. PRODUCT IDENTITY & CORE PRODUCT MODEL

**Product Identity**

* Persian Name: خانه‌یار
* English Name: KhanehYar
* Tagline: خانه‌یار؛ دستیار هوشمند خانه و خانواده
* Product Type: Comprehensive Household & Family Management Platform
* Primary Language: Persian
* Primary UI Direction: RTL
* Typography: Vazirmatn

**Brand Colors**

* Navy: `#0D1B2A`
* Emerald: `#10B981`
* Mint: `#34D399`

KhanehYar is a comprehensive household and family management platform designed to help a household manage, organize, track, and coordinate important aspects of home and family life in one integrated environment.
KhanehYar is NOT a finance application with several additional features.
Finance is one of the core domains alongside family, children, pets, vehicles, home equipment, shopping, bills, calendar, entertainment, goals, and documents.
The product must be designed as one coherent household ecosystem, not as a collection of unrelated standalone modules.

**Core Product Principle — Connected Household Data**
All domains must be interconnected.
A real-world entity, activity, transaction, reminder, document, or event must be linkable to relevant entities across the system without unnecessary duplication.
Example:

```text
Vehicle Oil Change
    │
    ├── Vehicle
    ├── Maintenance Record
    ├── Finance Transaction
    ├── Receipt / Document
    └── Future Reminder
```

The system must maintain a single source of truth for each real-world entity.
Do NOT create duplicate representations of the same entity merely because it appears in multiple domains.

**Core Product Domains**

1. Home
2. Family
3. Children
4. Pets
5. Vehicles & Transportation
6. Home Equipment & Appliances
7. Finance
8. Shopping & Home Inventory
9. Bills & Subscriptions
10. Family Calendar
11. Entertainment & Leisure
12. Goals & Wish Lists
13. Documents & Records

These domains must cooperate through explicit relationships, shared entities, events, reminders, tasks, financial records, and documents.

## 2. USERS, HOUSEHOLDS & MEMBERSHIP MODEL

### 2.1 Independent User Accounts
Every person using KhanehYar has an independent user account.
Do NOT design the system around shared household usernames or shared passwords.
A User may belong to multiple Households.
Conceptually:

```text
USER
  │
  ├── Profile
  │
  └── HouseholdMembership
          │
          ├── Household A → ADMIN
          └── Household B → MEMBER
```

### 2.2 Household
`Household` is a first-class domain entity and the primary tenant/security boundary.
All household-scoped data must belong to a specific Household.
The system must support:

* Multiple households per user
* One active household context at a time
* Strict household-level data isolation
* Different roles for the same user in different households

The active Household must always be explicit.
Never trust the client to define authorization context.

### 2.3 Household Creation
When a User creates a Household:

* The creator becomes an ACTIVE member.
* The creator becomes the Household Creator.
* The creator initially receives ADMIN.
* Creator and Administrator are separate concepts.

The Creator is the person who originally created the Household.
An Administrator is a member who currently has administrative privileges.
The Creator may promote at most one additional ACTIVE member to ADMIN.
Therefore:

```text
Maximum Administrators per Household = 2
```

### 2.4 Initial Roles
Initial roles:

```text
ADMIN
MEMBER
```

Do NOT introduce unnecessarily complex RBAC.
The architecture must, however, support future fine-grained authorization.
Role alone must NOT determine access to every resource.

### 2.5 Membership States
Membership must use explicit states:

```text
PENDING
ACTIVE
REJECTED
EXPIRED
SUSPENDED
REMOVED
```

Only ACTIVE members receive normal household access.
Removing membership must NOT automatically:

* Delete the User account
* Delete historical records
* Delete household data
* Rewrite historical ownership
* Delete audit history

Membership lifecycle and account lifecycle are separate.

### 2.6 Joining a Household
Supported methods:

1. Invitation Link
2. Household Code

Entering a code must NOT directly grant membership.
Required flow:

```text
Validate Code
    ↓
Identify Household
    ↓
Create Join Request
    ↓
PENDING
    ↓
Administrator Approval
    ↓
ACTIVE
```

Invitation links/codes must be:

* Secure
* Non-guessable
* Revocable
* Regeneratable
* Expirable where appropriate

Possession of a link/code must never bypass authentication or authorization.

### 2.7 Household Isolation
A User must never access another Household's data because they:

* Know an entity ID
* Manipulate a URL
* Modify a request body
* Modify a household ID
* Modify local state
* Call the API directly
* Belong to another Household

Household isolation must be enforced server-side.
Frontend checks are UX controls only.

### 2.8 Auditability
Sensitive and administrative operations should record:

* Actor
* Action
* Timestamp
* Household
* Affected entity/resource

Do not store unnecessary sensitive payloads in audit logs.

## 3. ONBOARDING & HOUSEHOLD SETUP

KhanehYar already has a household onboarding experience.
Before modifying it, inspect the existing implementation.
Do NOT replace it with an unrelated implementation without auditing the current flow.
The onboarding has two primary paths:

```text
CREATE A FAMILY
JOIN A FAMILY
```

### 3.1 Create a Family
Required:

* Family/Household Name
* Declared Number of Family Members

Optional:

* Individual member identities/details
* Domain information
* Other household information

Family member identities are NOT mandatory during initial onboarding.

### 3.2 Declared Member Count
Distinguish between:

```text
Declared Family Member Count
```

and:

```text
Actual Registered/Active Household Members
```

Example:

```text
Declared Members = 4

Registered Accounts:
- Member A → ACTIVE
- Member B → ACTIVE

Other declared members:
- Not registered yet
```

Do not force every declared family member to create an account during onboarding.

### 3.3 Household Setup
After creating a Household, the User may configure the main domains.
Every domain can be:

* Completed
* Partially completed
* Skipped

Completing all domains during onboarding is NOT mandatory.
Examples:

```text
Family → Completed
Children → Skipped
Pets → No pets
Vehicles → 1 vehicle
Finance → Partially configured
Documents → Skipped
```

### 3.4 Progressive Setup
Users must be able to return later through:

```text
Settings
    ↓
Household Setup
```

Skipped information must NOT be considered an error.
If no Pets exist, the Pets domain should not be treated as an incomplete task.

### 3.5 Dashboard
The dashboard must be context-aware.
Do NOT display large numbers of empty domain cards.
Prioritize:

* Configured domains
* Active records
* Upcoming events
* Pending actions
* Relevant reminders
* Important household activity

Unconfigured domains may be represented through lightweight setup guidance.

### 3.6 Join a Family
The Join flow:

```text
Authenticate/Register
      ↓
Join Family
      ↓
Invitation Link / Household Code
      ↓
Join Request
      ↓
PENDING
      ↓
Admin Approval
      ↓
ACTIVE
```

A joining User must NOT recreate existing Household setup.

### 3.7 Onboarding Principle
Onboarding must be progressive:

```text
Create
  ↓
Configure what matters now
  ↓
Skip what doesn't
  ↓
Enter Dashboard
  ↓
Complete later
```

Do not force a large one-time questionnaire.

### 3.8 Onboarding Flow, Account Creation & Join Flow — ALREADY IMPLEMENTED, DO NOT MODIFY
The Create-a-Family onboarding flow (Welcome → Living Situation → Household Size → Goals → Domain Quick-Setup → Reminders Opt-In → Personalizing → Account Creation), the account-creation timing/consent behavior, and the Join Flow's lightweight feature preview are already implemented and finalized in the existing codebase.

* Do NOT redesign, rewrite, restructure, or "improve" this flow.
* Do NOT propose alternative onboarding steps, screens, or ordering.
* Inspect the existing implementation (per Section 0) to learn its exact screens, step order, data collected at each step, and how Goals map to Domain Quick-Setup and Dashboard prioritization.
* Treat this implementation as the source of truth for onboarding — every other part of this document (Domains in Section 1, Household model in Section 2, later sections) must be built to be consistent with what this flow already collects and produces, not the other way around.
* If any other section of this document appears to conflict with the existing onboarding implementation, follow Section 0: STOP, explain the conflict, and wait for approval rather than silently changing the onboarding flow to match.

> **حل‌شده (۱۴۰۵/۰۷/۰۳):** فهرستِ هشت‌صفحه‌ایِ بالا (Welcome → Living Situation → Household Size → Goals → Domain Quick-Setup → Reminders Opt-In → Personalizing → Account Creation) توصیفِ نادرستِ کدِ موجود است. خودِ همین بند می‌گوید «پیاده‌سازیِ موجود منبعِ حقیقت است»، پس **کد حاکم است و متنِ بالا منسوخ**. قیفِ واقعی **سه قدم** دارد و **پیش از هر فرمی** اجرا می‌شود:
>
> ```text
> welcome  →  value  →  questions  →  فرمِ ثبت‌نام (از پیش پر شده)
> ```
>
> * `welcome` و `value`: معرفی و ارزشِ محصول؛ خروجیِ دوم «قبلاً حساب دارم» است که مستقیم به فرمِ ورود می‌رود.
> * `questions`: نامِ خانواده (**تنها ورودیِ اجباری**)، تعدادِ اعضا، حوزه‌های موردِ تمرکز (چندگزینه‌ای) و واحدِ پول.
> * پاسخ‌ها به‌شکلِ `IntroDraft` در حافظهٔ دستگاه می‌مانند و فرمِ ثبت‌نام را از پیش پر می‌کنند؛ پس از ساختِ حساب اعمال و پاک می‌شوند. فلگِ «دیده شد» دستگاهی است، نه per-member — چون در آن لحظه هنوز عضوی وجود ندارد.
> * صاحبِ لینکِ دعوت این قیف را **نمی‌بیند** (خانواده‌اش از پیش معلوم است) و مستقیم به صفحهٔ پذیرشِ دعوت می‌رود.
>
> پنج صفحهٔ باقی‌ماندهٔ فهرستِ انگلیسی (Living Situation، Domain Quick-Setup، Reminders Opt-In، Personalizing و تفکیکِ Account Creation) **ساخته نمی‌شوند**؛ درخواستِ ساختشان تغییرِ دامنه است و تصمیمِ صریحِ مالک می‌خواهد.

## 4. ARCHITECTURE & SYSTEM DESIGN

KhanehYar must be implemented as a modular monolith with strong internal boundaries, unless a concrete requirement later justifies another architecture.
Do NOT introduce microservices prematurely.
The architecture must support:

* Web/PWA
* Future Android
* Future iOS
* Reusable business logic
* Strong household isolation
* Independent domain evolution
* Testability
* Secure cross-domain relationships

### 4.1 Architecture Principles
Follow:

1. Domain-driven modularity
2. Clean Architecture
3. Separation of concerns
4. Dependency inversion
5. Single source of truth
6. Explicit domain relationships
7. Household-aware authorization
8. Server-side security enforcement
9. Testable business logic
10. Framework independence where practical
11. No unnecessary domain coupling
12. No duplicated business concepts

### 4.2 Backend Layers
Conceptually:

```text
Presentation / API
        ↓
Application
        ↓
Domain
        ↑
Infrastructure
```

**Domain** contains: Entities, Value Objects, Aggregates, Domain Services, Domain Events, Business Rules, Domain Exceptions, Repository abstractions where appropriate.
Domain must NOT depend on: UI frameworks, HTTP, ORM implementations, Database providers, External API clients, Storage providers.

**Application** contains: Use Cases, Commands, Queries, Application Services, DTOs, Validation, Authorization orchestration, Transaction boundaries, Repository/service abstractions.
Application code must not depend directly on concrete infrastructure implementations.

**Infrastructure** contains: Database, ORM, Repository implementations, File storage, Authentication providers, External APIs, Notifications, Background jobs, Caching, Encryption implementation, Logging.

**Presentation/API** contains: API endpoints, Request/response mapping, Authentication middleware, Transport-level validation, Error translation, API documentation.
Controllers/endpoints must remain thin. Do NOT place business logic inside controllers.

### 4.3 Frontend Architecture
Use a modular feature-oriented architecture adapted to the existing codebase.
Do NOT restructure the existing frontend merely to match a theoretical folder convention.
First audit the existing architecture.
Conceptually:

```text
App
 ↓
Pages
 ↓
Features
 ↓
Entities
 ↓
Shared
```

Frontend is responsible for: Presentation, Interaction, UI state, Form state, Navigation, Client-side validation, API interaction.
Frontend must NOT be the source of truth for security or business-critical authorization.

### 4.4 Core / Shared Kernel
Potential foundational concepts:

```text
User
Household
HouseholdMembership
Person / FamilyMember
Role
Permission
Attachment
DocumentReference
Reminder
Task
Notification
AuditEntry
DomainEvent
```

Do NOT turn Shared/Core into a dumping ground. Only genuinely foundational concepts belong there.

### 4.5 Domain Areas

```text
Family
Children
Pets
Vehicles
Home
Home Equipment
Finance
Shopping & Inventory
Bills & Subscriptions
Calendar
Entertainment & Leisure
Goals & Wish Lists
Documents
```

Finance is one domain, not the architectural center.
The existing Finance implementation must be preserved and integrated unless an explicit requirement justifies changes.

### 4.6 Cross-Cutting Capabilities
Some capabilities are reusable across domains.

**Tasks / Chores** may belong to: Household, Family member, Child, Pet, Vehicle, Home, Equipment, Shopping, Other relevant entities.
Do NOT create separate task systems for each domain.

**Maintenance** is a reusable capability associated with maintainable entities. Examples:

```text
Vehicle → Maintenance
Equipment → Maintenance
Home System → Maintenance
```

A Maintenance Record may link to: Maintained entity, Service provider, Cost, Finance transaction, Date, Usage/mileage, Documents, Parts, Future reminder, Task.

### 4.7 Cross-Domain Relationships
Cross-domain relationships are first-class. Examples:

```text
Vehicle ↕ Maintenance ↕ Finance ↕ Document ↕ Reminder ↕ Calendar
Child ↕ Activity ↕ Calendar ↕ Expense ↕ Document
Bill ↕ Finance ↕ Calendar ↕ Reminder
```

Do NOT duplicate data merely to integrate domains.

### 4.8 Domain Boundaries
A domain must not directly modify another domain's internal database structures.
Cross-domain interaction must use defined application/domain contracts.

### 4.9 Single Source of Truth
Every real-world entity must have one authoritative representation (Vehicle, Household, User, Family Member, Pet, Appliance, Bill, Financial Transaction, Document).
Do NOT create `FinanceVehicle` / `MaintenanceVehicle` / `DocumentVehicle` if a canonical Vehicle entity already exists.

### 4.10 Events
Use domain/application events where meaningful (VehicleMaintenanceCompleted, ExpenseCreated, BillDueSoon, MembershipApproved, DocumentUploaded, WarrantyExpiring, InventoryBelowThreshold).
Do NOT make every CRUD operation event-driven.

### 4.11 Repository/Data Access
Do NOT allow: `UI → Database`, `UI → ORM`, `Domain → ORM`, `Controller → arbitrary database`, `Business Logic → scattered raw SQL`.
All persistence must respect: Household scope, Authorization, Domain boundaries, Transactions, Ownership, History/deletion rules.

### 4.12 Existing Codebase Compatibility
Before implementation: inspect repository, frontend architecture, backend architecture, Finance, authentication, database schema, household/user/onboarding models, shared utilities, security controls; identify duplicates/conflicts.
If a conflict exists: STOP → explain → identify affected files/modules → present migration options → WAIT FOR APPROVAL.
Do NOT silently rewrite architecture. Do NOT create duplicate implementations.

### 4.13 Architecture Decision Rule

```text
Core business domain?         → Domain Area
Shared business capability?   → Cross-Cutting Capability
Foundational system concept?  → Core / Shared Kernel
Technical concern?            → Infrastructure
User-facing business workflow?→ Application
Presentation concern?         → Frontend
```

Navigation structure must NOT dictate domain architecture.

### 4.14 Future Mobile
Business rules must remain reusable through the backend/application layer. Future clients: Web/PWA, Android, iOS.
No critical business rule should exist exclusively inside the frontend.

### 4.15 Architecture Quality
Prioritize: Clear boundaries, Low coupling, High cohesion, Testability, Explicit dependencies, Predictable data flow, Strong authorization, Maintainability, Incremental extensibility.
Avoid: Premature microservices, Excessive abstraction, Generic repositories without purpose, Massive shared utilities, God services, God components, Circular dependencies, Hidden cross-module mutations, Duplicate entities, Business logic in UI, Business logic in controllers, Client-only security, Architecture rewrites without evidence.

## 5. SECURITY & PRIVACY ARCHITECTURE

Security and privacy are NON-NEGOTIABLE.
All server-side data must be treated as sensitive unless explicitly classified otherwise.
KhanehYar may contain: Financial information, Bank/account information, Personal information, Children information, Family relationships, Private wishes/goals, Documents, Vehicle information, Home information, Bills, Activity history, Uploaded files.
Security must be implemented from the architecture level, not added later.

### 5.1 Security Principles
1. Server-side authorization
2. Deny by default
3. Least privilege
4. Explicit access policies
5. Household isolation
6. Resource-level authorization
7. Property-level authorization
8. Function-level authorization
9. Secure authentication
10. Secure session management
11. Data minimization
12. TLS/HTTPS
13. Encryption at rest
14. Secure file storage
15. Secure logging
16. Secure backups
17. Secure deletion
18. Auditability
19. Defense in depth
20. Fail closed

These principles align with OWASP guidance on authorization, including server-side enforcement, least privilege and deny-by-default.

### 5.2 Data Classification
At minimum:

```text
PUBLIC
HOUSEHOLD_SHARED
MEMBER_PRIVATE
SENSITIVE
HIGHLY_SENSITIVE
SYSTEM_SECRET
```

* **HOUSEHOLD_SHARED** — Household name, Shared calendar, Shared shopping, Shared chores, Shared equipment, Shared vehicles, Shared bills, Shared activities.
* **MEMBER_PRIVATE** — Personal goals, Personal wish lists, Private notes, Personal preferences.
* **SENSITIVE** — Member personal information, Child information, Insurance, Maintenance history, Restricted financial data.
* **HIGHLY_SENSITIVE** — Bank accounts, Account balances, Sensitive transactions, Identity documents, Legal/financial documents, Security information.
* **SYSTEM_SECRET** — Password hashes, Session secrets, API keys, Encryption keys, Service credentials, Signing secrets.

System secrets must never be exposed through ordinary APIs.

### 5.3 Authorization Model
Authorization must consider:

```text
Authenticated User + Active Household + Membership State + Role
+ Resource Ownership + Resource Sensitivity + Requested Action + Authorization Policy
```

Never trust client-provided: User ID, Household ID, Role, Ownership, Permission, Authorization result.

### 5.4 Parent / Administrator Access
Parents designated as Household Administrators should have broad access to household information and management (Family, Children, Pets, Vehicles, Home, Equipment, Shopping, Bills, Calendar, Shared Finance, Shared Documents, Maintenance, Tasks, Shared Goals, Family Activities).
However: ADMIN does NOT automatically override explicitly private personal information. A personal Wish List or private note belonging to another User remains private unless explicitly shared or authorized.

### 5.5 Adult Member Access
Adult members may have broad household access according to resource policies. Example:

```text
Shared Calendar → Allowed
Shared Shopping → Allowed
Shared Tasks → Allowed
Shared Vehicle → Allowed
Shared Equipment → Allowed
Another User's Personal Wish List → DENIED
Another User's Private Notes → DENIED
Sensitive Financial Data → Policy-controlled
Private Documents → Policy-controlled
```

### 5.6 Child Access
Children must have restricted access.
May access: Own profile, Own activities, Own tasks, Own calendar items, Own goals, Own wish list, Explicitly shared family information, Age-appropriate household information.
Must NOT automatically access: Bank accounts, Account balances, Sensitive financial records, Sensitive documents, Identity documents, Private adult information, Private member notes, Security settings, Authentication information, Highly sensitive household data.
Backend enforcement is mandatory. Hiding menu items is NOT authorization.

### 5.7 Personal Data Ownership
Personal Wish Lists are private by default.

```text
User A └── Personal Wish List
User B └── Personal Wish List
Child A └── Personal Wish List
```

One user must not access another user's Wish List merely because they share a Household. Owner-controlled sharing may be supported.

```text
PRIVATE → Owner Only
SHARED  → Explicitly Authorized Users
```

### 5.8 Resource-Level Authorization
For every protected resource, verify:
1. Authentication
2. Session validity
3. Household membership
4. ACTIVE membership state
5. Resource household ownership
6. Resource access permission
7. Field-level permission

Never perform an unrestricted object lookup based only on a client-provided ID.
OWASP specifically recommends object-level authorization checks on each request and warns against relying on unpredictable IDs as a substitute for authorization.

### 5.9 Field-Level Authorization
A user may access an entity but not every property. Example:

```text
FamilyMember
 ├── Name → Allowed
 ├── Picture → Allowed
 ├── Phone → Policy-controlled
 ├── Bank Account → Restricted
 ├── Balance → Restricted
 └── Identity Document → Restricted
```

Never return an unrestricted database object and expect the frontend to hide sensitive fields. Use explicit response DTOs/schemas.

### 5.10 Function-Level Authorization
Explicitly protect: Create Household, Delete Household, Promote Administrator, Remove Administrator, Approve Join Request, Remove Member, View Financial Accounts, Export Household Data, Download Sensitive Document, Delete Sensitive Document, Change Security Settings.
Discovering an API endpoint must never grant access.

### 5.11 Authentication
Use modern secure authentication. Requirements: Argon2id or appropriately configured secure password hashing; Never plaintext passwords; Never reversible passwords; Secure password reset; Rate limiting; Brute-force protection; Secure sessions/tokens; Session expiration; Session revocation; Secure logout; Credential-stuffing protection; Account enumeration protection where appropriate; Re-authentication for highly sensitive operations where appropriate.
Authentication does NOT imply authorization.

### 5.12 Session Security
Sessions/tokens must be: Cryptographically secure, Non-predictable, Scoped, Revocable, Expirable, Protected against theft, Invalidated appropriately.
For browser authentication, use secure cookie/session mechanisms where appropriate (`HttpOnly`, `Secure`, `SameSite`) when cookies are used.

### 5.13 Encryption in Transit
All production application communication must use HTTPS/TLS. No plaintext HTTP production endpoints. Secure: API communication, Authentication, Documents, External services.

### 5.14 Encryption at Rest
Protect sensitive server-side data at rest: Database, Backups, Documents, Sensitive exports, Temporary sensitive files, Storage volumes.
Use established cryptographic primitives. Do NOT invent custom encryption algorithms. Encryption keys must be securely managed and must not be stored insecurely alongside encrypted data.

### 5.15 Documents
Documents are highly sensitive. Storage must be: Private, Access-controlled, Non-public, Non-guessable, Server-authorized, Protected from unauthorized modification/deletion.
Do NOT expose predictable public document URLs. Preferred model:

```text
Authenticated Request → Server Authorization → Short-Lived Access → Private File
```

Signed URLs, if used, must be short-lived and generated only after authorization.

### 5.16 Financial Data
Financial data requires enhanced protection. Separate `Shared Household Finance` from `Private / Restricted Finance`.
Every financial access must validate: Household, Membership, Role, Ownership, Sensitivity, Permission.

### 5.17 Child Data
Children's data requires additional protection. Do not allow child users to access sensitive: Financial data, Documents, Adult data, Security information, Private member information — unless explicitly designed and authorized.

### 5.18 API Security
Every protected endpoint must verify: Authentication, Household, Membership (ACTIVE), Function, Object, Property, Input validation, Output minimization, Rate Limiting, Audit.
Authorization must be systematic across the entire API. OWASP treats object-, property-, function-level and authentication failures as distinct API authorization risks.

### 5.19 IDOR/BOLA Protection
Never trust client-provided IDs. For `GET /documents/{id}`, `GET /transactions/{id}`, `GET /vehicles/{id}`, `DELETE /members/{id}`, `PATCH /wishlists/{id}` — the server must verify authorization for the referenced object.
Changing an ID must never expose another User's or Household's data. Random/UUID IDs are NOT a substitute for authorization.

### 5.20 Database Security
Parameterized queries; ORM/query safety; No SQL injection; Least-privilege database credentials; Separate environment credentials; No production credentials in source control; Secure migrations; Household scoping; Appropriate database security policies; Encrypted backups.
Do NOT use database superuser/root credentials for normal application operations.

### 5.21 Logging & Audit
Never log: Passwords, Access tokens, Session secrets, Encryption keys, Full bank secrets, Private document contents, Sensitive data unnecessarily.
Audit: Login/security events, Failed authorization, Membership changes, Administrator changes, Sensitive document access, Data exports, Security setting changes, Account deletion, Household deletion, Permission changes.
Audit logs must themselves be protected.

### 5.22 Error Handling
Production responses must not expose: Stack traces, SQL queries, Internal paths, Credentials, Secrets, Sensitive object information, Security implementation details. Detailed diagnostics belong only in protected server-side logs.

### 5.23 Backups
Backups must receive protection equivalent to production data: Encryption, Access control, Restricted credentials, Retention policy, Recovery testing, Protection from accidental deletion, Protection from unauthorized restoration.

### 5.24 Data Export
Exports must be explicitly authorized: Permission control, Explicit scope, Auditability, Secure temporary storage, Controlled lifetime, Secure deletion, Re-authentication where appropriate.

### 5.25 Account / Household Deletion
Distinct operations: Delete User Account, Remove Household Membership, Delete Household, Delete Household Data. Do not conflate them.
Define: Retention, Historical records, Audit records, Document deletion, Backup retention, Secure deletion lifecycle.

### 5.26 Third-Party Data Leakage
Do NOT send household data to third parties unless explicitly required and approved (Analytics, Advertising, AI services, Logging platforms, OCR, External processing, External search, External financial services).
If an external service is required: identify the data, minimize the data, document purpose, evaluate security/privacy, secure transport, obtain required approval.

### 5.27 Client-Side Storage
Do NOT treat LocalStorage, IndexedDB, Browser Cache, Service Worker Cache as secure vaults. Do not unnecessarily persist highly sensitive information client-side. Offline functionality involving sensitive data requires explicit security design.

### 5.28 Security Testing
At minimum test:

```text
User A → Household A → ALLOWED
User A → Household B → DENIED
Admin → Shared Data → ALLOWED
Member → Shared Data → Policy-dependent
Child → Family Calendar → ALLOWED where appropriate
Child → Bank Accounts → DENIED
Child → Sensitive Documents → DENIED
User A → User B Wishlist → DENIED
User A → User B Document → DENIED
Member → Admin Function → DENIED
```

Test authorization bypass attempts using: IDs, Household IDs, User IDs, Roles, Request bodies, Query parameters, HTTP methods, Routes, Hidden fields, Client state.
Automated authorization tests should be maintained as part of the release process. OWASP recommends automating authorization evaluation as part of releases.

### 5.29 Security Review for Every New Feature
Before implementing any new feature, answer:
1. Who owns this data?
2. Which Household does it belong to?
3. Who can view it?
4. Who can create it?
5. Who can modify it?
6. Who can delete it?
7. Which fields are sensitive?
8. Which roles/users can access those fields?
9. Is it private, shared, or restricted?
10. What happens if the object ID is changed?
11. What happens if the Household ID is changed?
12. What happens if the role is manipulated?
13. What must be audited?
14. What must never be logged?
15. What happens during export?
16. What happens during deletion?

If these questions cannot be answered clearly, the feature is NOT ready for implementation.

### 5.30 Security Priority
Security takes precedence over: Convenience, Development speed, UI simplicity, Feature completeness, Performance optimizations that weaken security.
If convenience conflicts with protection of household data: **PROTECT THE DATA FIRST**.
Default security posture: `NO EXPLICIT AUTHORIZATION → DENY`.
This deny-by-default model and server-side enforcement are core requirements, not optional implementation details.

## 6. LOCALIZATION & IRANIAN CONTEXT

### 6.1 Calendar
* Primary calendar: Jalali (Shamsi).
* Store all dates internally in a calendar-agnostic format (e.g. UTC/ISO); convert to Jalali only at the presentation layer.
* Gregorian may be shown as a secondary reference only where useful (e.g. a document that must sync with a foreign system).
* All date pickers, reminders, and recurring schedules (bills, maintenance, tasks) must use Jalali by default.

### 6.2 Currency
The currency model (including the Toman/Rial unit selection) is already implemented in the existing codebase.
* Do NOT redesign, replace, or change this existing currency logic.
* Inspect the existing implementation (per Section 0) before touching anything currency-related.
* Every new feature that involves money (Bills, Maintenance costs, Shopping budgets, Goals, Vehicle expenses, etc.) must reuse the existing currency logic and unit-handling exactly as implemented — never introduce a parallel or inconsistent currency representation.
* If a new feature's money handling cannot cleanly reuse the existing logic, STOP and report the conflict (per Section 0) instead of creating a second currency system.

### 6.3 Numerals
* Support both Persian (۰-۹) and Latin (0-9) digit display.
* This is a display/user-preference concern, not a data-storage concern — store numeric values as numbers, not localized strings.

## 7. NOTIFICATIONS & REMINDERS

### 7.1 Notification Sources
Any domain may generate a notification through the existing Reminder/Notification core entities (Section 4.4) — never a parallel per-domain notification system. Examples:

```text
BillDueSoon → Bills & Subscriptions
MaintenanceDue → Vehicles / Home Equipment
WarrantyExpiring → Documents
InventoryBelowThreshold → Shopping
ChoreAssigned / ChoreOverdue → Chores/Tasks
CalendarEventUpcoming → Family Calendar
MembershipRequestPending → Household (Admin only)
```

> **حل‌شده (۱۴۰۵/۰۷/۱۲) — از این هفت منبع، سه تا امروز داده دارند؛ بقیه ماژولشان ساخته نشده.**
>
> | منبعِ §۷.۱ | وضعِ امروز |
> | --- | --- |
> | `MembershipRequestPending` | ✅ `join_requests` (مرحلهٔ B) — سیم‌کشی شد |
> | `CalendarEventUpcoming` | ✅ `family_events` + تولدهای هم‌گام‌شده — سیم‌کشی شد |
> | `BillDueSoon` | ✅ معادلش = تراکنشِ تکرارشوندهٔ سررسید — سیم‌کشی شد |
> | `MaintenanceDue` · `WarrantyExpiring` · `InventoryBelowThreshold` · `ChoreAssigned/Overdue` | ⬜ ماژولِ خودرو/سند/خرید/کارِ خانه وجود ندارد |
>
> **«هرگز سیستمِ موازیِ per-domain» چطور رعایت شد:** یک هستهٔ مشترک در `src/domain/notification/` و همهٔ منابع از همان عبور می‌کنند. ویجتِ `widgets/due-recurring` که پیش از این منطقِ خودش را داشت، مصرف‌کنندهٔ همان هسته شد تا دو مرجعِ حقیقت نماند.
>
> **اعلان‌ها «مشتق‌شده»اند، نه ذخیره‌شده — و این آگاهانه است.** §۴.۴ `Notification` را جزوِ «Potential foundational concepts» آورده (خودش می‌گوید *potential*). هر سه منبعِ فعال از دادهٔ موجود قابلِ‌استخراج‌اند، پس نشاندنِ رونوشتشان در جدول آن جدول را به یک **کش** تبدیل می‌کرد: رویدادِ پایه حذف شود، ردیفِ اعلان یتیم می‌ماند و فهرست دروغ می‌گوید. مهم‌تر اینکه هر سه **خودپاک‌کن**‌اند (سررسید رسیدگی شود، درخواست تأیید/رد شود، رویداد بگذرد → خودش می‌رود)، پس «خوانده/نخوانده» برایشان کارِ اضافهٔ بی‌معنی بود و شمارندهٔ اعلان = تعدادِ موردِ **زنده** که راست‌تر است. تنها استثنا رویدادِ کنش‌ناپذیر (تولد) است که «نادیده بگیر» می‌گیرد — و تنها همان ماندگار می‌شود.
>
> الگوی موجود هم همین بود: `handledOccurrences` از قبل «تصمیمِ کاربر روی یک رخدادِ مشتق‌شده» را ذخیره می‌کرد، نه خودِ رخداد را.

### 7.2 Delivery Channels
* In-app (always on, non-optional)
* Push notification (opt-in, per Section 3.9's Reminders Opt-In step)

SMS and Email are explicitly OUT OF SCOPE for now. Do not build channel abstractions for them speculatively — keep the notification system extensible enough to add channels later, but do not implement unused ones.

> **حل‌شده (۱۴۰۵/۰۷/۱۲) — تصمیمِ مالک: فقط کانالِ درون‌نرم‌افزاری. پوش ساخته نمی‌شود.**
>
> سه دلیلِ انباشته، نه یکی:
>
> ۱. **تحویلش در ایران نامطمئن است.** Web Push روی کروم/اندروید از زیرساختِ گوگل می‌گذرد و پوشِ نیتیوِ کپاسیتور هم Play Services می‌خواهد. یعنی احتمالاً برای بخشِ بزرگی از کاربرانِ هدف **نمی‌رسد** — و ساختنِ کانالی که نمی‌رسد بدتر از نساختنش است، چون کاربر رویش حساب می‌کند.
> ۲. **زمان‌بندی وجود ندارد.** تنها چیزِ موجود `BackgroundTasks`ِ FastAPI است که *پس از یک درخواست* اجرا می‌شود و با پاسخ می‌میرد. پوشِ «سه روز پیش از سررسید» بی‌زمان‌بندِ سروری شلیک نمی‌شود.
> ۳. **قیدِ تک‌ورکر.** یادداشتِ `backend/Dockerfile` افزودنِ `--workers` را تا تنظیمِ `RATE_LIMIT_SALT` ممنوع کرده. زمان‌بندِ درون‌فرایندی دلیلِ **دومی** برای تک‌ورکر ماندن اضافه می‌کند، چون با چند ورکر هر ورکر یک‌بار شلیک می‌کند و کاربر چند اعلانِ تکراری می‌گیرد.
>
> **ارجاعِ «Section 3.9's Reminders Opt-In step» بی‌مقصد است** و باید نادیده گرفته شود: §۳.۹ در این سند **وجود ندارد**، و خودِ آن صفحهٔ «Reminders Opt-In» در یادداشتِ ۱۴۰۵/۰۷/۰۳ زیرِ §۳.۸ جزوِ پنج صفحه‌ای شمرده شده که **ساخته نمی‌شوند**. پس رضایتی که این بند به آن ارجاع می‌دهد جایی برای گرفته‌شدن ندارد — و لازم هم نیست، چون کانالِ درون‌نرم‌افزاری به‌حکمِ همین بند «غیراختیاری» است و رضایت نمی‌خواهد.
>
> بندِ «برای کانال‌های استفاده‌نشده انتزاعِ حدسی نساز» **عیناً رعایت شد**: نه درزِ کانال ساخته شد، نه جدولِ اشتراکِ پوش، نه کلیدِ VAPID. افزودنِ پوش در آینده یک کارِ تازه است، نه پر‌کردنِ جای خالیِ آماده.

### 7.3 User Control
* Global on/off toggle (set during onboarding, Section 3.8 step 6)
* Per-domain toggle (e.g. mute Chores reminders, keep Bills reminders)
* Quiet hours (no push during a user-defined time window; in-app notifications still queue normally)

> **حل‌شده (۱۴۰۵/۰۷/۱۲):** هر سه بند با واقعیتِ کانالِ درون‌نرم‌افزاری هم‌تراز شد.
>
> **۱) کلیدِ کلی — جایش تنظیمات است، نه آنبوردینگ.** ارجاعِ «Section 3.8 step 6» بی‌مقصد است: §۳.۸ «ALREADY IMPLEMENTED, DO NOT MODIFY» است و یادداشتِ ۱۴۰۵/۰۷/۰۳ نشان داد قیفِ واقعی **سه قدم** دارد، پس گامِ ششمی وجود ندارد. تصمیمِ مالک: کلیدها در **زیرصفحهٔ «اعلان‌ها» در تنظیمات** می‌نشینند و قیفِ آغازین دست‌نخورده می‌ماند.
>
> **۲) تنشِ ظاهریِ §۷.۲ با این بند:** §۷.۲ درون‌نرم‌افزاری را «غیراختیاری» می‌خواند و این بند «کلیدِ خاموش» می‌دهد. خوانشِ حاکم: §۷.۲ دربارهٔ **کانال** است (کانالی نیست که کاربر باید به آن رضایت دهد یا زیرساختش را روشن کند)، و §۷.۳ دربارهٔ **سلیقه** است (کاربر می‌تواند صدای اعلان‌ها را بخواباند). این دو یک چیز نیستند، پس تعارضِ واقعی نبود.
>
> **۳) ساعاتِ سکوت عمداً اجرا نمی‌شود.** به‌حکمِ متنِ خودِ همین بند، ساعاتِ سکوت فقط **پوش** را مهار می‌کند و اعلانِ درون‌نرم‌افزاری «طبقِ معمول در صف می‌ماند». با نبودِ پوش، پیاده‌سازی‌اش یعنی کلیدی که هیچ رفتاری را عوض نمی‌کند — همان الگوی «محافظتِ نمایشیِ مُرده» که در §۸ دو بار دیدیم (قاعدهٔ `*.supabase.co` و «پاک‌شدنِ کش هنگامِ خروج» که فقط روی کاغذ بود). این بند همان روزی زنده می‌شود که کانالِ پوش ساخته شود.
>
> **۴) زمانِ پیش‌هنگام (§۷.۴) جای ساعاتِ سکوت را در UI گرفت** — چون آن یکی *واقعاً* روی اعلانِ درون‌نرم‌افزاری اثر دارد و §۷.۴ هم صریحاً می‌خواهد per-domain و قابلِ‌تنظیم باشد نه سراسریِ هاردکد.

### 7.4 Timing Rules
* Each domain defines its own lead time (e.g. Bill: 3 days before due date, Maintenance: configurable per item, Chore: at assignment + at due time).
* Lead time defaults must be domain-specific, not hardcoded globally.

> **حل‌شده (۱۴۰۵/۰۷/۱۲) — پیش‌فرض‌های per-domain و یک تلهٔ مهم.**
>
> | دامنه | پیش‌هنگام | چرا |
> | --- | --- | --- |
> | تراکنشِ تکرارشونده | ۳ روز | همان مثالِ خودِ این بند برای قبض |
> | رویداد و تولد | ۷ روز | تولد آماده‌سازی می‌خواهد (کادو)، نه خبرِ همان‌روز |
> | درخواستِ عضویت | ۰ (درجا) | تاریخِ آینده‌ای ندارد؛ *همین حالا* در انتظار است |
>
> هر سه قابلِ‌تنظیم‌اند و هیچ‌کدام سراسری نیستند.
>
> **تله (وارسی‌شده در کد، نه حدس):** `dueOccurrences` در `domain/transaction/recurring.rules.ts` سقفش `min(today, repeatEnd)` است، یعنی **فقط سررسیدهای رسیده/گذشته** را برمی‌گرداند. پس آن تابع «due soon» نمی‌دهد، «overdue» می‌دهد. برای پیاده‌سازیِ «۳ روز پیش از سررسید» وسوسه این بود که افقِ همان تابع به آینده کشیده شود — که **ویجتِ موجود را خراب می‌کرد**: آن ویجت از مدیر می‌پرسد «انجام شد؟» و با افقِ آینده شروع می‌کرد دربارهٔ تاریخ‌هایی بپرسد که هنوز نرسیده‌اند. پس `dueOccurrences` دست‌نخورده ماند و هستهٔ اعلان، «نزدیک» را جدا از «گذشته» حساب می‌کند. هر دو در فهرست می‌آیند ولی با شدتِ متفاوت.

### 7.5 Authorization
A notification must never reveal data the recipient isn't authorized to see (Section 5.9) — e.g. a Chore reminder to a Child must not embed financial details even if the underlying entity links to a Finance transaction.

### 7.6 Delivery Failure
Failed push delivery must not block or corrupt the underlying domain event — the in-app notification remains the source of truth.

## 8. OFFLINE & PWA BEHAVIOR

### 8.1 Scope
KhanehYar is Web/PWA-first. Offline support goes beyond read-only caching: most day-to-day household actions should work offline and sync when connection returns — with sensitive data as the one hard exception.

### 8.2 Full Offline Read Cache
All PUBLIC and HOUSEHOLD_SHARED data (Section 5.2) the user has access to should be cached locally for offline viewing: Dashboard, Chores, Shopping, Calendar, Bills list, Maintenance schedule, Vehicles, Pets, etc.

> **حل‌شده (۱۴۰۵/۰۷/۱۱):** این بند **آینده‌نگر** است، نه توصیفِ وضعِ امروز — و امروز عمداً اجرا نمی‌شود.
>
> دلیل، تعارضِ خودِ سند با خودش نیست؛ نتیجهٔ مستقیمِ §۸.۳ و §۵.۲۷ است. تنها داده‌ای که خانه‌یارِ امروز دارد تراکنش و موجودی و حساب و عضویت است، و §۸.۳ هر چهار را در فهرستِ «NOT allowed offline» گذاشته. پس مجموعهٔ دادهٔ «قابلِ کش برای خواندنِ آفلاین» در این لحظه **تهی** است: چیزی نیست که §۸.۲ اجازهٔ کش‌کردنش را بدهد.
>
> رفتارِ حاکمِ امروز: سرویس‌ورکر فقط **پوستهٔ نرم‌افزار** را نگه می‌دارد (HTML/CSS/JS و آیکون‌ها). درخواست‌های `/api/v1/**` با `NetworkOnly` از کنارِ کش می‌گذرند و هرگز ذخیره نمی‌شوند. کاربرِ آفلاین نرم‌افزار را باز می‌کند ولی به‌جای دادهٔ کهنه، پیامِ «اتصال نیست» می‌بیند.
>
> این یک تصمیمِ قفل‌شدهٔ مالک است («امنیت برنده — آفلاین فقط پوسته»). §۵.۲۷ و §۸.۵ دست‌نخورده‌اند و **نباید** برای راحتی سست شوند.
>
> §۸.۲ از همان لحظه‌ای زنده می‌شود که ماژول‌های خانه (کار و خرید و تقویم و…) ساخته شوند — چون آن‌ها دادهٔ HOUSEHOLD_SHARED دارند و §۸.۳ خودش اجازهٔ آفلاین‌شدنشان را داده. تا آن روز، پیاده‌سازیِ §۸.۲ یعنی ریختنِ دادهٔ مالی در کش، که همان چیزی است که §۵.۲۷ منع کرده.
>
> §۸.۴ (موتورِ هم‌گام‌سازی و صفِ نوشتن) هم تا آن روز موضوعی ندارد: صفی که فقط می‌تواند خالی باشد، موتور لازم ندارد.

> **به‌روزرسانی (۱۴۰۵/۰۷/۲۱) — شرطِ بالا برآورده شد؛ ولی اجرا عمداً عقب افتاد.**
>
> یادداشتِ ۱۴۰۵/۰۷/۱۱ گفته بود «§۸.۲ از همان لحظه‌ای زنده می‌شود که ماژول‌های خانه (کار و خرید و تقویم و…) ساخته شوند». آن لحظه رسیده: **قبوض** (۰۷/۱۸)، **تقویم** (۰۷/۱۹) و **خرید و انبار** (۰۷/۲۱) هر سه دادهٔ HOUSEHOLD_SHARED دارند و §۸.۲ خودش «Shopping, Calendar, Bills list» را نام برده. پس مجموعهٔ قابلِ کش **دیگر تهی نیست** و این یادداشت بخشی از استدلالش را از دست داده.
>
> تصمیمِ مالک (۱۴۰۵/۰۷/۲۱): **آن ماژول‌ها الان فقط آنلاین کار می‌کنند و لایهٔ آفلاین یک مرحلهٔ مستقل است.** دلیل: کشِ خواندن بی‌معناست اگر صفِ نوشتنِ §۸.۴ نباشد (کاربر دادهٔ کهنه را می‌بیند، تغییرش می‌دهد، و تغییر گم می‌شود)، و §۸.۴ خودش می‌گوید «هیچ کنشِ صف‌شده‌ای بی‌صدا دور انداخته نمی‌شود» و «تعارض باید به کاربر نشان داده شود، نه آخرین‌نویسنده-برنده روی دادهٔ مشترک». نیمه‌ساختنش بدتر از نساختنش بود.
>
> آن‌چه عوض **نشد**: مرزِ §۸.۳ و §۵.۲۷ دست‌نخورده است (مالی و اسناد و عضویت و هر فیلدِ حساس هرگز آفلاین نمی‌شوند) و سرویس‌ورکر همچنان `/api/v1/**` را با `NetworkOnly` از کنارِ کش می‌گذراند. یعنی امروز هم کاربرِ آفلاین پیامِ «اتصال نیست» می‌بیند، نه دادهٔ کهنه.

### 8.3 Offline Writes (queued, synced on reconnect)
Allowed to be created/edited/completed fully offline:
* Chores/Tasks (create, edit, complete, assign)
* Shopping list items (add, check off, remove)
* Calendar events (non-sensitive)
* Maintenance log entries (note-only; no cost/Finance link until online)
* Inventory quantity updates

NOT allowed offline — require a live connection, no local queueing:
* Anything touching Finance transactions/balances
* Anything touching Documents (upload/download/view)
* Household membership actions (create, join, approve, promote, remove)
* Any SENSITIVE or HIGHLY_SENSITIVE field (Section 5.2)

This boundary follows directly from Section 5.27 and must not be loosened for convenience.

> **حل‌شده (۱۴۰۵/۰۷/۲۱) — دو سطرِ اولِ فهرستِ «مجاز» حالا موضوع دارند، ولی هنوز آفلاین نیستند.**
>
> «Shopping list items (add, check off, remove)» و «Inventory quantity updates» با ساختِ §۱.۸ از حرف به داده تبدیل شدند — این نخستین باری است که فهرستِ «مجاز به آفلاین» چیزی برای پوشاندن دارد (پیش از این، هر چه نرم‌افزار داشت در فهرستِ «NOT allowed» بود).
>
> ولی تصمیمِ مالک این شد که **در این برش فقط آنلاین** ساخته شود؛ استدلالش در یادداشتِ §8.2 بالا است. پس امروز لمسِ «تیک» یا «+۱» بی‌اتصال خطای شبکه می‌دهد، نه صف.
>
> **این بند سست نشده و نباید بشود.** مرزش دقیقاً همان است که بود: هر چیزِ مالی، اسناد، کنش‌های عضویت و هر فیلدِ SENSITIVE/HIGHLY_SENSITIVE بیرون می‌مانند — و در خودِ ماژولِ §۱.۸ هم همین رعایت شده: «خرید انجام شد» که تراکنشِ هزینه می‌سازد، **عمداً** در فهرستِ کارهای آفلاینِ آیندهٔ این ماژول نیست، چون به Finance دست می‌زند.

### 8.4 Sync Engine
* Background Sync (Service Worker) retries queued actions automatically when connectivity returns — the user should not have to manually "sync."
* Server is always the source of truth on conflict.
* Conflicts must be surfaced to the user, never silently resolved with last-write-wins on shared household data (e.g. two people completed the same Chore, or edited the same Calendar event, while offline).
* A queued action is never silently dropped — either it syncs or the user is shown why it failed.

### 8.5 Client-Side Storage
* Governed by Section 5.27 — offline cache must never hold HIGHLY_SENSITIVE data (bank details, documents, identity info).
* Cached data is cleared on logout.
* Any locally queued write must itself be treated as sensitive until synced (encrypted at rest on-device where the platform allows it).

> **حل‌شده (۱۴۰۵/۰۷/۱۱) — «Cached data is cleared on logout» تا امروز فقط روی کاغذ بود.** `LogoutUseCase` تنها نشست را می‌بست و هیچ‌جای کد کشِ سرویس‌ورکر را پاک نمی‌کرد. حالا پاک‌کردن به **خودِ خروج** گره خورده (درزِ `OfflineCacheStore` در دامنه، پیاده‌سازی در `infrastructure/storage/offlineCache.adapter.ts`، تزریق در `LogoutUseCase` و `LogoutAllUseCase`) — نه به یک دکمه در تنظیمات، چون این بند وعده‌ای دربارهٔ *خروج* است و هر مسیرِ خروجیِ آینده باید خودبه‌خود پوشیده شود.
>
> سه مرزِ عمدی: (۱) **همهٔ** کش‌ها پاک می‌شوند نه فهرستی گزیده — «فقط کشِ داده» امروز یعنی پاک‌کردنِ هیچ، و پاک‌کردنِ کامل اگر §۸.۲ روزی روشن شود هم درست می‌ماند. (۲) `localStorage` پاک **نمی‌شود**: فلگِ قیفِ آغازین و یادآورِ نصب و نوعِ نمودار دادهٔ خانواده نیستند و `clear()` قیفِ آغازین را بعد از هر خروج دوباره سبز می‌کرد. (۳) سرویس‌ورکر `unregister` **نمی‌شود**، چون همان کانالِ به‌روزرسانیِ نسخهٔ اندروید است.
>
> بندِ سوم (صفِ نوشتنِ رمزشده) موضوعی ندارد تا §۸.۳ زنده شود — صفی وجود ندارد.

### 8.6 Connectivity Feedback
UI must clearly show offline state, what's queued, and what's unavailable — never let a user attempt a connection-required action (Finance, Documents, membership) without immediate feedback that it needs a connection.

> **بخشاً اجرا‌شده (۱۴۰۵/۰۷/۱۱) — و آن بخشِ اجرا‌نشده عمداً این‌جا نوشته می‌شود تا ادعای دروغ نشود.**
>
> ✅ **حالتِ آفلاین نشان داده می‌شود:** نوارِ `OfflineBar` (در `shared/ui`) در **همهٔ** فازها رندر می‌شود — از جمله صفحهٔ ورود، چون کاربری که آفلاین روی فرمِ ورود گیر کرده بیش از همه به این خبر نیاز دارد؛ بی آن، «رمزم غلط است» برداشت می‌کند. متنش دو جمله است و جملهٔ دومش دلیلِ **خالی‌بودنِ صفحه** را می‌گوید، وگرنه خالی‌بودن شبیهِ «داده‌هایم پاک شد» خوانده می‌شود — و همین، بندِ «what's unavailable» را به‌صورتِ سراسری پوشش می‌دهد.
>
> ⬜ **«what's queued» موضوعی ندارد:** صفِ نوشتنِ §۸.۳ وجود ندارد (یادداشتِ §۸.۲).
>
> ⚠️ **بازماندهٔ آگاهانه:** بازخوردِ **به‌ازای‌هر‌کنش** نیست. کاربرِ آفلاین هنوز می‌تواند «ثبتِ خرج» را بزند و خطای شبکه بگیرد، به‌جای آنکه از پیش بشنود «این کار به اتصال نیاز دارد». نوار حالتِ کلی را می‌گوید ولی دکمه‌ها را غیرفعال نمی‌کند. این، کارِ بازِ ثبت‌شده است نه ادعای انطباق.
>
> قاعدهٔ صداقتِ تشخیص (تله): `navigator.onLine` فقط وقتی `false` است قابل‌اعتماد است؛ گوشیِ وصل‌به‌وای‌فایِ بی‌اینترنت هم `true` می‌دهد. پس `shared/lib/useOnline.ts` هرگز «آنلاین» ادعا نمی‌کند، محیطِ ناشناس را آنلاین می‌گیرد، و **هیچ‌جا** نباید با آن تصمیمِ «حالا می‌شود درخواست فرستاد» گرفته شود.

## 9. LOGIN (Returning User)

### 9.1 Entry Point
The Welcome screen (Section 3.8, step 1) offers both "Get Started" (→ onboarding, new user/household) and "Log In" (→ this flow, returning user).

### 9.2 Authentication Methods
Same providers as Account Creation (Section 3.9): Google, Apple, Email — one consistent auth system, not a parallel login implementation.

> **حل‌شده (۱۴۰۵/۰۶/۳۱):** این بند با واقعیتِ کد هم‌تراز شد. احراز هویتِ حاکم **موبایل + رمز + OTP** است، نه Google/Apple/Email. «سیستمِ واحد» یعنی همین. رجوع به یادداشتِ بالای فایل.

### 9.3 Post-Login Routing

```text
Login successful
      ↓
Does the user have any ACTIVE Household membership?
      │
      ├── No  → Onboarding (Create or Join a Family, Section 3.1/3.6)
      ├── One → Load that Household as active context → Dashboard
      └── Multiple → Household switcher → user selects active Household → Dashboard
```

> **حل‌شده (۱۴۰۵/۰۷/۰۳):** شاخهٔ سومِ این نمودار — «Multiple → Household switcher» — **منسوخ** است و ساخته نمی‌شود.
> مدلِ هویتِ حاکم تصمیمِ قفل‌شدهٔ **C1** است: *یک شمارهٔ موبایل = دقیقاً یک خانواده*. پس هیچ کاربری «چند عضویت» ندارد و سوییچِ خانواده موضوعیت پیدا نمی‌کند.
> مسیرِ درستِ پس از ورود دو شاخه است:
>
> ```text
> ورودِ موفق
>       ↓
> آیا عضویتِ ACTIVE دارد؟
>       ├── نه  → قیفِ آغازین / صفحهٔ «در انتظارِ تأییدِ مدیر» (§۲.۵ و §۲.۶)
>       └── آری → همان خانواده به‌عنوان زمینهٔ فعال → داشبورد
> ```
>
> اگر روزی «چند-خانواده» لازم شد، اول باید C1 با تصمیمِ صریحِ مالک باز شود؛ تا آن روز، ساختنِ سوییچر نقضِ مشخصات است.

### 9.4 Session Handling
* Governed by Section 5.12 (Session Security) — secure, revocable, expirable sessions/tokens.
* "Remember me" / persistent login on trusted devices is allowed, but re-authentication is still required for HIGHLY_SENSITIVE actions (Section 5.11) even within an active session.

### 9.5 Forgot Password / Account Recovery
Standard secure reset flow (Section 5.11) — never reveal whether an email/phone is registered (account enumeration protection).

> **حل‌شده (۱۴۰۵/۰۷/۰۶):** این بند تا ۲۰۲۶-۰۹-۲۷ **اصلاً پیاده نشده بود** (شکافِ #۱۴ در `audit-2026-09-23-sections-6-9.md`). حالا پیاده شده و «مسیرِ استانداردِ امن» در خانه‌یار یعنی دقیقاً این:
>
> * **دو گام، هر دو بی‌نیاز به نشست:** `POST /api/v1/auth/password-reset/request` (شماره) و `POST /api/v1/auth/password-reset/confirm` (شماره + کدِ ۶رقمی + رمزِ تازه).
> * **ضدِ شمارشِ حساب (خواستهٔ صریحِ همین بند):** گامِ ۱ **همیشه** `{"ok": true}` می‌دهد — شمارهٔ ثبت‌نشده، شمارهٔ در کول‌داون، و شمارهٔ واقعی پاسخِ بایت‌به‌بایت یکسان می‌گیرند. پس کول‌داونِ ۶۰ثانیه‌ای **بی‌صداست** و ارسالِ پیامک در `BackgroundTasks` می‌رود تا کانالِ جانبیِ *زمانِ پاسخ* هم بسته شود. در گامِ ۲ هم شمارهٔ ناشناس همان `INVALID_OTP/400`ِ کدِ غلط را می‌گیرد.
> * **کد هرگز در پاسخ برنمی‌گردد** — برخلافِ مسیرِ ورود که در حالتِ توسعه `dev_code` می‌دهد. تنها مسیرِ دیدنش پیامک است (و در توسعه، لاگِ سرور).
> * **ذخیره‌سازی:** کدها در `otp_codes` با ستونِ `purpose` (`login` / `password_reset`) و **هش‌شده** می‌نشینند (`code_hash`؛ HMAC-SHA256ِ فلفل‌خورده) — مهاجرتِ `0008`. بی‌`purpose`، کدی که برای ورود فرستاده شده بود می‌توانست رمز را عوض کند.
> * **پس از تغییرِ رمز `logout_all`** اجرا می‌شود (نه `revoke_others`ِ مسیرِ «تغییرِ رمز»): فرضِ بازیابی این است که رمزِ قبلی از دستِ کاربر خارج شده. پاسخ نشستِ تازه نمی‌دهد؛ کاربر از مسیرِ عادیِ ورود می‌آید تا گیتِ وضعیتِ عضویت (§۲.۶) هم اعمال شود.
> * **درگاهِ پیامک** درزِ `services/sms.py` است (آداپتورِ کاوه‌نگار + آداپتورِ خنثی). تا وقتی `SMS_API_KEY` خالی است هیچ پیامکی نمی‌رود و مسیر روی تولید خودش را **خاموش** اعلام می‌کند (`SMS_NOT_CONFIGURED/503`)؛ `GET /auth/config` پرچمِ `password_reset_enabled` را می‌دهد تا کلاینت دکمهٔ «فراموشیِ رمز» را وقتی بی‌فایده است نشان ندهد. این پرچم عمداً وضعیتِ **سرور** است، نه چیزی دربارهٔ کاربر — وگرنه خودش اوراکلِ شمارش می‌شد.
> * **مهارِ نرخ:** `RL_PASSWORD_RESET_PER_IP` روی هر دو گام، با سطلِ جدا برای هرکدام؛ کلیدْ HMACِ نمک‌خوردهٔ IP است نه خودِ IP (§۵ — دادهٔ حساس ذخیره نمی‌شود).
> * **۱۹ تست** در `backend/tests/test_password_reset.py` هر کدام از تصمیم‌های بالا را قفل می‌کنند. شرحِ کامل: «✅ رفع‌شده — ۲۰۲۶-۰۹-۲۷ (شکافِ #۱۴)» در `audit-2026-09-23-sections-6-9.md`.

## GLOBAL HARD IMPLEMENTATION RULES

1. AUDIT BEFORE CODING.
2. Inspect the existing repository before changing architecture, database, frontend, backend, onboarding, authentication, or Finance.
3. Do NOT create a new project.
4. Do NOT rewrite the existing Finance module without explicit justification.
5. Do NOT duplicate existing features.
6. Do NOT duplicate real-world entities.
7. Do NOT assume missing requirements.
8. If requirements are ambiguous, STOP and ask.
9. If the current implementation conflicts with this specification, STOP and report the conflict.
10. Do NOT silently perform destructive migrations.
11. Security and privacy override convenience and speed.
12. Authorization must always be enforced server-side.
13. Never rely on frontend authorization.
14. Never trust client-provided household/user/role/ownership information.
15. Every household-scoped resource must be authorized against the authenticated user's ACTIVE membership.
16. Sensitive fields must have explicit response/authorization policies.
17. Private data must be private by default.
18. Shared data must be explicitly classified as shared.
19. Children must never inherit adult access automatically.
20. ADMIN must NOT automatically bypass explicitly private personal information.
21. Personal Wish Lists are private by default.
22. Financial and document data require enhanced protection.
23. Do not expose sensitive data in logs, errors, URLs, analytics, or third-party services.
24. Do not use predictable public file URLs.
25. Do not treat UUIDs/random IDs as authorization.
26. Do not place business logic inside UI components.
27. Do not place business logic inside controllers.
28. Do not allow domains to directly modify other domains' persistence structures.
29. Do not introduce microservices without a concrete requirement.
30. Do not introduce unnecessary abstractions.
31. Search the existing codebase before creating a new entity, service, component, route, table, hook, utility, or feature.
32. Prefer extending an existing correct implementation over creating a parallel implementation.
33. Maintain automated authorization tests for security-critical access rules.
34. Every new feature must pass the Security Review checklist before implementation.
35. When in doubt between exposing data and protecting data, protect the data.
36. DO NOT START IMPLEMENTATION UNTIL THE REQUIRED AUDIT HAS BEEN COMPLETED.
