/** Display copy only: executable validation and circuit data cannot be translated here. */
export interface MissionTranslation {
  title: string;
  summary: string;
  learningObjectives: string[];
  realWorldUse: string;
  ncertAnchors: string[];
  steps: Record<string, { instruction: string; hint: string; whyItMatters: string }>;
}

export const step = (instruction: string, hint: string, whyItMatters: string) => ({ instruction, hint, whyItMatters });
export const CIRCUITS_HI = 'कक्षा 10, अध्याय 12: विद्युत — विद्युत परिपथ और परिपथ आरेख';
export const HEATING_HI = 'कक्षा 10, अध्याय 12: विद्युत — विद्युत धारा का तापीय प्रभाव';
