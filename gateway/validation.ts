import { GraphQLError, isListType, isNonNullType } from "graphql";
import type { ValidationContext, ASTVisitor } from "graphql";

export type ValidationRule = (context: ValidationContext) => ASTVisitor;

/**
 * Field cost weights keyed by type name then field name.
 * A cost of 0 means the field is free (e.g. trivial scalars).
 */
export type CostMap = Record<string, Record<string, number>>;

/**
 * Rejects queries exceeding the configured nesting depth.
 * Depth is measured as the number of nested Field selections.
 */
export function createMaxDepthRule(maxDepth: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => {
    let maxFound = 0;

    function fieldDepth(
      ancestors: readonly (unknown | readonly unknown[])[]
    ): number {
      return ancestors.filter(
        (a) => !Array.isArray(a) && (a as { kind?: string }).kind === "Field"
      ).length;
    }

    return {
      Field(_node, _key, _parent, _path, ancestors) {
        maxFound = Math.max(maxFound, fieldDepth(ancestors) + 1);
      },
      Document: {
        leave() {
          if (maxFound > maxDepth) {
            context.reportError(
              new GraphQLError(
                `Query depth limit of ${maxDepth} exceeded (depth: ${maxFound}).`
              )
            );
          }
          maxFound = 0;
        },
      },
    };
  };
}

/**
 * Rejects queries with more tokens (fields + arguments) than the configured limit.
 * Prevents parser exhaustion before execution even begins.
 */
export function createMaxTokensRule(maxTokens: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => {
    let count = 0;
    return {
      Field() {
        count++;
      },
      Argument() {
        count++;
      },
      Document: {
        leave() {
          if (count > maxTokens) {
            context.reportError(
              new GraphQLError(
                `Query token limit of ${maxTokens} exceeded (tokens: ${count}).`
              )
            );
          }
          count = 0;
        },
      },
    };
  };
}

/**
 * Demand control: assigns a cost to every field in the query and rejects
 * the operation when the total exceeds maxCost.
 *
 * Cost resolution order:
 *   1. Explicit entry in costMap[typeName][fieldName]
 *   2. defaultListCost  — field whose return type is a list (wraps any nesting)
 *   3. defaultFieldCost — everything else
 *
 * Cost is computed at validation time (pre-execution), so it guards against
 * expensive queries before any resolver or subgraph call is made.
 */
export function createCostAnalysisRule(
  maxCost: number,
  costMap: CostMap = {},
  defaultListCost: number = 10,
  defaultFieldCost: number = 1
): ValidationRule {
  return (context: ValidationContext): ASTVisitor => {
    let totalCost = 0;

    function computeFieldCost(): number {
      const parentType = context.getParentType();
      const fieldDef = context.getFieldDef();

      if (!parentType || !fieldDef) return defaultFieldCost;

      const typeCosts = costMap[parentType.name];
      if (typeCosts && fieldDef.name in typeCosts) {
        return typeCosts[fieldDef.name];
      }

      const t = fieldDef.type;
      const isList =
        isListType(t) || (isNonNullType(t) && isListType(t.ofType));
      return isList ? defaultListCost : defaultFieldCost;
    }

    return {
      Field() {
        totalCost += computeFieldCost();
      },
      Document: {
        leave() {
          if (totalCost > maxCost) {
            context.reportError(
              new GraphQLError(
                `Query cost limit of ${maxCost} exceeded (cost: ${totalCost}).`
              )
            );
          }
          totalCost = 0;
        },
      },
    };
  };
}

/**
 * Rejects queries using more directives than the configured limit.
 * Prevents DoS via directive explosion.
 */
export function createMaxDirectivesRule(maxDirectives: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => {
    let count = 0;
    return {
      Directive() {
        count++;
      },
      Document: {
        leave() {
          if (count > maxDirectives) {
            context.reportError(
              new GraphQLError(
                `Query directive limit of ${maxDirectives} exceeded (directives: ${count}).`
              )
            );
          }
          count = 0;
        },
      },
    };
  };
}
