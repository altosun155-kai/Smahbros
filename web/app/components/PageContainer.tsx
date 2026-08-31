// PageContainer — wraps the existing .page-container class (style.css:192),
// which also carries the mobile bottom-nav padding-bottom overrides via the
// `main.page-container` selector -- must stay a <main>, not a <div>, for
// those media-query rules to apply.
import type { HTMLAttributes } from 'react';

export default function PageContainer({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  const classes = ['page-container', className].filter(Boolean).join(' ');
  return <main className={classes} {...rest} />;
}

export function PageHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = ['page-header', className].filter(Boolean).join(' ');
  return <div className={classes} {...rest} />;
}
