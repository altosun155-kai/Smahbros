// Card — wrapper around the existing .card class (style.css:278). hover=true
// adds .card-hover for the lift/border-highlight-on-hover variant used on
// clickable list-item cards throughout the legacy pages.
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export default function Card({ hover, className, ...rest }: CardProps) {
  const classes = ['card', hover && 'card-hover', className].filter(Boolean).join(' ');
  return <div className={classes} {...rest} />;
}
