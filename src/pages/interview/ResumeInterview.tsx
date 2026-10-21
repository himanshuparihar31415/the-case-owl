import { FileText } from 'lucide-react';
import ComingSoonInterview from './ComingSoonInterview';

export default function ResumeInterview() {
  return (
    <ComingSoonInterview
      Icon={FileText}
      tagline="Interview · Resume-Based"
      title="Resume-Based Interview"
      description="Upload your CV and get grilled on it. Every bullet is fair game, and vague answers get followed up."
      willDo={[
        'Questions generated from your own experience, not a generic list',
        'Probing follow-ups on impact, ownership, and numbers',
        'A scorecard on which bullets held up and which fell apart',
      ]}
    />
  );
}
