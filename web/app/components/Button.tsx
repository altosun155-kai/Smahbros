// Button — typed wrapper around the existing .btn/.btn-* classes in
// web/public/css/style.css. No new visual design: variant/size map 1:1 onto
// classes draft/page.tsx already hand-typed (btn btn-primary, btn-outline, …).
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'gold' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
}

export default function Button({ variant = 'primary', small, className, type = 'button', ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, small && 'btn-sm', className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}
