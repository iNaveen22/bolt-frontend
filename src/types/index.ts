export const StepType = {
  CreateFile: "CreateFile",
  CreateFolder: "CreateFolder",
  EditFile: "EditFile",
  DeleteFile: "DeleteFile",
  RunScript: "RunScript"
} as const;

export type StepType = typeof StepType[keyof typeof StepType];


export interface Step {
  id: number;
  title: string;
  description: string;
  type: StepType;
  status: 'pending' | 'in-progress' | 'completed';
  code?: string;
  path?: string;
}

export interface Project {
  prompt: string;
  steps: Step[];
}

export interface FileItem {
  name: string;
  type: 'file' | 'folder';
  children?: FileItem[];
  content?: string;
  path: string;
}

export interface FileViewerProps {
  file: FileItem | null;
  onClose: () => void;
}