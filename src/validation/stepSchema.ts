import { z } from "zod";
import { StepType } from "../types"; 

const StepTypeEnum = z.enum([
  StepType.CreateFile,
  StepType.CreateFolder,
  StepType.EditFile,
  StepType.DeleteFile,
  StepType.RunScript,
]);

const Base = z.object({
  type: StepTypeEnum,
  path: z.string().optional(),
  code: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});

// 3) Per-type rules
export const StepSchema = z.discriminatedUnion("type", [
  Base.extend({
    type: z.literal(StepType.CreateFile),
    path: z.string().min(1, "path required for CreateFile"),
    code: z.string().default(""),
  }),

  Base.extend({
    type: z.literal(StepType.CreateFolder),
    path: z.string().optional(),
  }),

  Base.extend({
    type: z.literal(StepType.EditFile),
    path: z.string().min(1, "path required for EditFile"),
    code: z.string().default(""),
  }),

  Base.extend({
    type: z.literal(StepType.DeleteFile),
    path: z.string().min(1, "path required for DeleteFile"),
  }),

  Base.extend({
    type: z.literal(StepType.RunScript),
    code: z.string().min(1, "code/script required for RunScript"),
  }),
]);

export const StepsSchema = z.array(StepSchema).min(1);
export type ValidStep = z.infer<typeof StepSchema>;