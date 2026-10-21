import { MessageSquare } from 'lucide-react';
import ComingSoonInterview from './ComingSoonInterview';

export default function GeneralInterview() {
  return (
    <ComingSoonInterview
      Icon={MessageSquare}
      tagline="Interview · General"
      title="General Interview"
      description="Why this firm, why you, tell me about a failure. The questions everyone gets, answered out loud so they stop sounding rehearsed."
      willDo={[
        'Fit, motivation, and behavioural questions in a live voice conversation',
        'Feedback on structure, specificity, and tone',
        'Stories you can reuse across firms',
      ]}
    />
  );
}
