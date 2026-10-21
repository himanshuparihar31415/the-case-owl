import { Users } from 'lucide-react';
import ComingSoonInterview from './ComingSoonInterview';

export default function GroupDiscussion() {
  return (
    <ComingSoonInterview
      Icon={Users}
      tagline="Interview · Group Discussion"
      title="Group Discussion"
      description="Practise the round where half the room talks over each other. You'll debate AI participants on a live topic and get scored on what you actually added."
      willDo={[
        'Realistic AI panel with different personalities and agendas',
        'Feedback on openings, interjections, and how you close',
        'Topic bank for business, policy, and current affairs',
      ]}
    />
  );
}
