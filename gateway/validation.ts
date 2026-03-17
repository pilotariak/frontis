import { GraphQLError } from "graphql";
import type { ValidationContext, ASTVisitor } from "graphql";

export type ValidationRule = (context: ValidationContext) => ASTVisitor;

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
