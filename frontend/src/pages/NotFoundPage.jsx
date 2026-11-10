import { Link } from 'react-router-dom';
import { Button, Logo } from '../components/ui/index.jsx';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div>
        <p className="font-display text-6xl font-semibold text-brand-600">404</p>
        <p className="mt-2 text-ink-2 dark:text-slate-400">That page doesn’t exist.</p>
      </div>
      <Link to="/">
        <Button>Go home</Button>
      </Link>
    </div>
  );
}
