import { CheckCircle, Circle, Clock } from 'lucide-react';
import type { Step } from '../types/index.js';

interface StepsListProps {
  steps: Step[];
  currentStep: number;
  onStepClick: (stepId: number) => void;
  activity?: string;
}

export function StepsList({ steps, currentStep, onStepClick, activity }: StepsListProps) {
  const isBuilding = steps.some((s) => s.status === "in-progress");
  return (
    <div className="bg-gray-900 rounded-lg shadow-lg p-4 h-full overflow-auto">
      <div className='fle justify-between items-center mb-3'>
        <h2 className="text-lg font-semibold mb-4 text-gray-100">Build Steps</h2>
      </div>

      {/* Top loader */}
      {isBuilding && (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-300">
          <div className="h-4 w-4 rounded-full border-2 border-gray-500 border-t-transparent animate-spin" />
          <span>{activity || "Building..."}</span>
        </div>
      )}
      <div className="space-y-4">
        {steps.map((step) => (
          <div
            key={step.id}
            className={`p-1 rounded-lg cursor-pointer transition-colors ${currentStep === step.id
                ? 'bg-gray-800 border border-gray-700'
                : 'hover:bg-gray-800'
              }`}
            onClick={() => onStepClick(step.id)}
          >
            <div className="flex items-center gap-2">
              {step.status === 'completed' ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : step.status === 'in-progress' ? (
                <Clock className="w-5 h-5 text-blue-400" />
              ) : (
                <Circle className="w-5 h-5 text-gray-600" />
              )}
              <h3 className="font-medium text-gray-100">{step.title}</h3>
            </div>
            <p className="text-sm text-gray-400 mt-2">{step.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}