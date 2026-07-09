import type { LoopDefinition, LoopNodeHandler, LoopValidator } from "./types";

export class LoopRegistry {
  private definitions = new Map<string, LoopDefinition>();
  private handlers = new Map<string, LoopNodeHandler>();
  private validators = new Map<string, LoopValidator>();

  registerDefinition(definition: LoopDefinition): void { this.definitions.set(definition.id, definition); }
  getDefinition(id: string): LoopDefinition | undefined { return this.definitions.get(id); }
  listDefinitions(): LoopDefinition[] { return Array.from(this.definitions.values()); }
  registerHandler(id: string, handler: LoopNodeHandler): void { this.handlers.set(id, handler); }
  getHandler(id: string): LoopNodeHandler | undefined { return this.handlers.get(id); }
  registerValidator(id: string, validator: LoopValidator): void { this.validators.set(id, validator); }
  getValidator(id: string): LoopValidator | undefined { return this.validators.get(id); }
}
