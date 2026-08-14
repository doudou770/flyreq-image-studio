# Code Commenting Specifications

To ensure code readability and maintainability, you must strictly adhere to the following commenting standards:

- **Language Requirement**: All comments (including class, method, inline, and documentation comments) **MUST be written in Chinese**.
- **Full Method Coverage**: Every single method, function, or API endpoint must include a clear docstring/comment explaining its purpose, input parameters, and return values.
- **Granularity for Critical Logic**: Provide deep, granular, and step-by-step Chinese comments for complex business logic, algorithms, architectural bottlenecks, or critical state mutations.

# Page Modification Compatibility Standards

Whenever a task involves modifying a page, component, style, or interaction, implementation and verification MUST satisfy all three requirements below. Changes MUST NOT be completed for only one device or display environment:

- **Mobile and PC compatibility**: Page layouts, buttons, dialogs, forms, lists, and core interactions MUST support both mobile and PC widths. Check narrow screens for overflow, occlusion, misalignment, inaccessible controls, and unintended horizontal scrolling.
- **Theme compatibility**: Every added or modified color, border, background, text, icon, shadow, and state style MUST support both the light and dark themes provided by the project, with consistent contrast, readability, and state recognition.
- **Multilingual compatibility**: All user-facing text MUST use the existing internationalization mechanism and MUST NOT be hard-coded in a single language. Check text length, wrapping, button widths, feedback messages, and layout stability in every supported language.

After completing a page modification, you MUST verify the mobile layout, PC layout, light theme, dark theme, and every language supported by the project. If any item cannot be verified, the delivery notes MUST explicitly state the reason and impact.


# Decision Determinism & Conflict Resolution

When executing tasks, designing architectures, or proposing technical solutions, **ambiguity, vagueness, or fence-sitting expressions are STRICTLY PROHIBITED** (e.g., avoid phrases like "You could use A or B," "It depends," or "The latency is around 100ms to 500ms").

## The Determinism Principle
- **Deliver Concrete Solutions**: You must proactively evaluate the project's technology stack, performance requirements, and constraints, then commit to **the single most optimal, scientific, and concrete solution or exact numerical value**. Do not pass the decision-making burden back to the user.

## The "Interruption & Inquiry" Mechanism
If you encounter a scenario where a definitive decision is impossible due to insufficient context or conflicting business requirements, **DO NOT guess or hallucinate**. Instead, follow this protocol:
1. **Halt automatic execution immediately.**
2. **Present a clear, structured comparison** of the viable options (detailing the pros, cons, and trade-offs of each).
3. **Ask a direct, targeted question** to guide the user to make the strategic choice.

# Customization Configuration

- **Environment Variables First**: Any content that needs to be customized **MUST** be configured through environment variables whenever technically possible. Do not hard-code customizable values in source files or static configuration files.
- **Mandatory Blocker**: If a required customization cannot be placed in environment variables, **halt the task immediately** and explain the technical reason and impact to the user before making any implementation decision.
