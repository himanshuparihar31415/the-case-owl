import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';
import './RequestAccess.css';
import { OwlMark } from './Landing';
import { COUNTRIES, DEFAULT_COUNTRY, findCountry } from '@/src/lib/countries';
import { submitBetaRequest, type BetaAccessRequest, type BetaRole, type InterviewInterest } from '@/src/lib/betaAccess';

interface RequestAccessProps {
  onOpenAuth: () => void;
}

const ROLES: { id: BetaRole; label: string; hint: string }[] = [
  { id: 'student', label: 'Student', hint: 'Preparing for placements or internships' },
  { id: 'professional', label: 'Working professional', hint: 'Switching into consulting or product' },
  { id: 'tpo', label: 'Training & Placement Officer', hint: 'Bringing The Case Owl to your college' },
];

const INTERESTS: { id: InterviewInterest; label: string }[] = [
  { id: 'case', label: 'Consulting cases' },
  { id: 'product', label: 'Product (PM)' },
  { id: 'guesstimate', label: 'Guesstimates' },
];

const PROGRAMS = ['MBA', 'PGDM', 'BBA', 'B.Tech / B.E.', 'B.Com', 'BA Economics', 'M.Tech', 'MS', 'Executive MBA'];
const EXPERIENCE = ['Less than 1 year', '1–3 years', '3–5 years', '5–8 years', '8+ years'];
const STUDENT_COUNTS = ['Under 200', '200–500', '500–1,000', '1,000–5,000', '5,000+'];
const SOURCES = ['LinkedIn', 'Instagram', 'Friend or colleague', 'College / placement cell', 'Google search', 'WhatsApp group', 'Other'];

const THIS_YEAR = new Date().getFullYear();
const GRAD_YEARS = Array.from({ length: 9 }, (_, i) => String(THIS_YEAR - 2 + i));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Errors = Record<string, string>;

export default function RequestAccess({ onOpenAuth }: RequestAccessProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [dialCode, setDialCode] = useState(findCountry(DEFAULT_COUNTRY)!.dial);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<BetaRole | ''>('');

  const [college, setCollege] = useState('');
  const [program, setProgram] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [organization, setOrganization] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [experience, setExperience] = useState('');
  const [designation, setDesignation] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [studentCount, setStudentCount] = useState('');

  const [interests, setInterests] = useState<InterviewInterest[]>([]);
  const [source, setSource] = useState('');
  const [sourceOther, setSourceOther] = useState('');

  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Unique dial codes for the phone prefix picker (several countries share +1, +44, +7 …).
  const dialOptions = useMemo(() => {
    const seen = new Map<string, string[]>();
    COUNTRIES.forEach((c) => seen.set(c.dial, [...(seen.get(c.dial) ?? []), c.code]));
    return [...seen.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([dial, codes]) => ({ dial, label: `+${dial} ${codes.slice(0, 3).join('/')}${codes.length > 3 ? '…' : ''}` }));
  }, []);

  const onCountryChange = (code: string) => {
    setCountry(code);
    const c = findCountry(code);
    if (c) setDialCode(c.dial);
  };

  const toggleInterest = (id: InterviewInterest) =>
    setInterests((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const validate = (): Errors => {
    const e: Errors = {};
    const req = (key: string, val: string, msg = 'Required') => { if (!val.trim()) e[key] = msg; };
    req('fullName', fullName, 'Please enter your full name');
    if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address';
    req('country', country, 'Select your country');
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4 || digits.length + dialCode.length > 15) e.phone = 'Enter a valid phone number';
    if (!role) e.role = 'Tell us who you are';
    if (role === 'student') {
      req('college', college, 'Enter your college name');
      req('program', program, 'Enter your degree or program');
      req('gradYear', gradYear, 'Select your graduation year');
    }
    if (role === 'professional') {
      req('organization', organization, 'Enter your organization');
      req('jobTitle', jobTitle, 'Enter your job title');
      req('experience', experience, 'Select your experience');
    }
    if (role === 'tpo') {
      req('college', college, 'Enter your college name');
      req('designation', designation, 'Enter your designation');
      req('city', city, 'Enter the college city');
      req('stateRegion', stateRegion, 'Enter the state or region');
      req('studentCount', studentCount, 'Select an approximate number');
    }
    if (role !== 'tpo' && interests.length === 0) e.interests = 'Pick at least one';
    req('source', source, 'Let us know how you found us');
    if (source === 'Other') req('sourceOther', sourceOther, 'Tell us where');
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitError('');
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = formRef.current?.querySelector<HTMLElement>(`[data-field="${Object.keys(e)[0]}"]`);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const payload: BetaAccessRequest = {
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      country,
      phone: { dialCode, number: phone.replace(/\D/g, '') },
      role: role as BetaRole,
      ...(role === 'student' && { student: { college: college.trim(), program: program.trim(), graduationYear: gradYear } }),
      ...(role === 'professional' && { professional: { organization: organization.trim(), jobTitle: jobTitle.trim(), experience } }),
      ...(role === 'tpo' && { tpo: { college: college.trim(), designation: designation.trim(), city: city.trim(), state: stateRegion.trim(), studentCount } }),
      interests,
      source,
      ...(source === 'Other' && { sourceOther: sourceOther.trim() }),
      submittedAt: new Date().toISOString(),
    };
    setSubmitting(true);
    try {
      await submitBetaRequest(payload);
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const err = (key: string) => errors[key] && <span className="ra-err">{errors[key]}</span>;
  const cls = (key: string) => `ra-input${errors[key] ? ' bad' : ''}`;

  return (
    <div className="owl-landing ra">
      <nav className="nav scrolled">
        <div className="wrap nav-in">
          <Link to="/" className="brand"><OwlMark /> The Case Owl</Link>
          <div className="nav-r">
            <a className="signin" onClick={onOpenAuth}>Sign in</a>
          </div>
        </div>
      </nav>

      <div className="wrap ra-grid">
        {/* Pitch */}
        <aside className="ra-side dark dark-glow">
          <span className="eyebrow">Private beta</span>
          <h1>The chair is <span className="cy">by invitation</span> — for now.</h1>
          <p>We're opening The Case Owl to a small group at a time, so every early user gets a partner that's tuned and ready. Tell us a little about you.</p>
          <ol className="ra-steps">
            <li><b>1</b><div><strong>Request access</strong><span>Two minutes, no payment.</span></div></li>
            <li><b>2</b><div><strong>We review it</strong><span>Every request is read by a person.</span></div></li>
            <li><b>3</b><div><strong>You get your login</strong><span>Credentials arrive by email once approved.</span></div></li>
          </ol>
          <div className="ra-side-foot">Already approved? <a onClick={onOpenAuth}>Sign in →</a></div>
        </aside>

        {/* Form / success */}
        <section className="ra-card">
          {done ? (
            <div className="ra-done">
              <div className="ra-done-mark"><OwlMark /></div>
              <span className="eyebrow">Request received</span>
              <h2>Thanks, {fullName.trim().split(/\s+/)[0]}.</h2>
              <p>The owl has your details. Once your access is approved, we'll email your login details to <b>{email.trim().toLowerCase()}</b>.</p>
              <div className="ra-done-cta">
                <Link className="btn btn-navy" to="/">Back to home</Link>
                <button type="button" className="btn btn-out" onClick={onOpenAuth}>I have my login</button>
              </div>
            </div>
          ) : (
            <form ref={formRef} onSubmit={handleSubmit} noValidate>
              <h2>Request beta access</h2>
              <p className="ra-sub">All fields are required unless marked optional.</p>

              <div className="ra-section">
                <div className="ra-row">
                  <label className="ra-field" data-field="fullName">
                    <span>Full name</span>
                    <input className={cls('fullName')} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Priya Sharma" autoComplete="name" />
                    {err('fullName')}
                  </label>
                </div>
                <div className="ra-row">
                  <label className="ra-field" data-field="email">
                    <span>Email</span>
                    <input type="email" className={cls('email')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@college.edu" autoComplete="email" />
                    {err('email')}
                  </label>
                </div>
                <div className="ra-row two">
                  <label className="ra-field" data-field="country">
                    <span>Country</span>
                    <select className={cls('country')} value={country} onChange={(e) => onCountryChange(e.target.value)} autoComplete="country">
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                    {err('country')}
                  </label>
                  <div className="ra-field" data-field="phone">
                    <span>Phone number</span>
                    <div className={`ra-phone${errors.phone ? ' bad' : ''}`}>
                      <select aria-label="Country code" value={dialCode} onChange={(e) => setDialCode(e.target.value)}>
                        {dialOptions.map((o) => <option key={o.dial} value={o.dial}>{o.label}</option>)}
                      </select>
                      <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s-]/g, ''))} placeholder="98765 43210" autoComplete="tel-national" aria-label="Phone number" />
                    </div>
                    {err('phone')}
                  </div>
                </div>
              </div>

              <div className="ra-section" data-field="role">
                <div className="ra-label">I am a…</div>
                <div className="ra-roles" role="radiogroup">
                  {ROLES.map((r) => (
                    <button type="button" key={r.id} role="radio" aria-checked={role === r.id}
                      className={`ra-role${role === r.id ? ' on' : ''}`} onClick={() => setRole(r.id)}>
                      <strong>{r.label}</strong><span>{r.hint}</span>
                    </button>
                  ))}
                </div>
                {err('role')}

                {role === 'student' && (
                  <div className="ra-reveal">
                    <div className="ra-row">
                      <label className="ra-field" data-field="college">
                        <span>College / university</span>
                        <input className={cls('college')} value={college} onChange={(e) => setCollege(e.target.value)} placeholder="e.g. IIM Ahmedabad" />
                        {err('college')}
                      </label>
                    </div>
                    <div className="ra-row two">
                      <label className="ra-field" data-field="program">
                        <span>Degree / program</span>
                        <input className={cls('program')} list="ra-programs" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="e.g. MBA" />
                        <datalist id="ra-programs">{PROGRAMS.map((p) => <option key={p} value={p} />)}</datalist>
                        {err('program')}
                      </label>
                      <label className="ra-field" data-field="gradYear">
                        <span>Graduation year</span>
                        <select className={cls('gradYear')} value={gradYear} onChange={(e) => setGradYear(e.target.value)}>
                          <option value="">Select</option>
                          {GRAD_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                        {err('gradYear')}
                      </label>
                    </div>
                  </div>
                )}

                {role === 'professional' && (
                  <div className="ra-reveal">
                    <div className="ra-row">
                      <label className="ra-field" data-field="organization">
                        <span>Organization</span>
                        <input className={cls('organization')} value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="e.g. Deloitte" autoComplete="organization" />
                        {err('organization')}
                      </label>
                    </div>
                    <div className="ra-row two">
                      <label className="ra-field" data-field="jobTitle">
                        <span>Job title</span>
                        <input className={cls('jobTitle')} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Business Analyst" autoComplete="organization-title" />
                        {err('jobTitle')}
                      </label>
                      <label className="ra-field" data-field="experience">
                        <span>Work experience</span>
                        <select className={cls('experience')} value={experience} onChange={(e) => setExperience(e.target.value)}>
                          <option value="">Select</option>
                          {EXPERIENCE.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                        {err('experience')}
                      </label>
                    </div>
                  </div>
                )}

                {role === 'tpo' && (
                  <div className="ra-reveal">
                    <div className="ra-row two">
                      <label className="ra-field" data-field="college">
                        <span>College / institution</span>
                        <input className={cls('college')} value={college} onChange={(e) => setCollege(e.target.value)} placeholder="e.g. XYZ Institute of Management" />
                        {err('college')}
                      </label>
                      <label className="ra-field" data-field="designation">
                        <span>Your designation</span>
                        <input className={cls('designation')} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Head – Placements" />
                        {err('designation')}
                      </label>
                    </div>
                    <div className="ra-row two">
                      <label className="ra-field" data-field="city">
                        <span>City</span>
                        <input className={cls('city')} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Pune" autoComplete="address-level2" />
                        {err('city')}
                      </label>
                      <label className="ra-field" data-field="stateRegion">
                        <span>State / region</span>
                        <input className={cls('stateRegion')} value={stateRegion} onChange={(e) => setStateRegion(e.target.value)} placeholder="e.g. Maharashtra" autoComplete="address-level1" />
                        {err('stateRegion')}
                      </label>
                    </div>
                    <div className="ra-row">
                      <label className="ra-field" data-field="studentCount">
                        <span>Approx. students preparing for placements</span>
                        <select className={cls('studentCount')} value={studentCount} onChange={(e) => setStudentCount(e.target.value)}>
                          <option value="">Select</option>
                          {STUDENT_COUNTS.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                        {err('studentCount')}
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="ra-section">
                <div className="ra-field" data-field="interests">
                  <div className="ra-label">{role === 'tpo' ? 'Interview types your students prepare for (optional)' : 'What are you preparing for?'}</div>
                  <div className="ra-chips">
                    {INTERESTS.map((i) => (
                      <button type="button" key={i.id} aria-pressed={interests.includes(i.id)}
                        className={`ra-chip${interests.includes(i.id) ? ' on' : ''}`} onClick={() => toggleInterest(i.id)}>
                        {interests.includes(i.id) && <span aria-hidden>✓</span>} {i.label}
                      </button>
                    ))}
                  </div>
                  {err('interests')}
                </div>
                <div className="ra-row two">
                  <label className="ra-field" data-field="source">
                    <span>How did you hear about us?</span>
                    <select className={cls('source')} value={source} onChange={(e) => setSource(e.target.value)}>
                      <option value="">Select</option>
                      {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {err('source')}
                  </label>
                  {source === 'Other' && (
                    <label className="ra-field" data-field="sourceOther">
                      <span>Where?</span>
                      <input className={cls('sourceOther')} value={sourceOther} onChange={(e) => setSourceOther(e.target.value)} placeholder="Tell us" />
                      {err('sourceOther')}
                    </label>
                  )}
                </div>
              </div>

              {submitError && <div className="ra-submit-err">{submitError}</div>}
              <button type="submit" className="btn btn-navy ra-submit" disabled={submitting}>
                {submitting ? 'Sending…' : <>Request access <span className="ar">→</span></>}
              </button>
              <p className="ra-fine">We'll only use these details to review your request and contact you about the beta.</p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
