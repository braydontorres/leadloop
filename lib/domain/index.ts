/**
 * Framework-independent LeadLoop domain boundary.
 *
 * These modules contain deterministic business rules only: neither React, Next
 * route handlers, browser storage, nor a database client is imported here. The
 * existing web app continues importing the original modules during the gradual
 * cloud migration; native and cloud clients should import this public gateway.
 */
export * from "../calendar-expression";
export * from "../conversation-machine";
export * from "../customer-memory";
export * from "../quotes";
export * from "../reminder-details";
export * from "../tasks";
