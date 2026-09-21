'use client';

import React from 'react';
import Link from 'next/link';
import { LucideIcon, HelpCircle, ArrowRight } from 'lucide-react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  recommendation?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
    icon?: LucideIcon;
  };
  secondaryAction?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon = HelpCircle,
  title,
  description,
  recommendation,
  action,
  secondaryAction,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center p-8 sm:p-12 max-w-lg mx-auto ${className}`}>
      <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100/80 flex items-center justify-center text-amber-600 mb-4 shadow-sm">
        <Icon className="w-7 h-7" strokeWidth={1.75} />
      </div>

      <h3 className="text-base font-semibold text-slate-900 tracking-tight mb-1.5">
        {title}
      </h3>

      <p className="text-sm text-slate-500 leading-relaxed mb-2">
        {description}
      </p>

      {recommendation && (
        <div className="flex items-start gap-2 bg-slate-50 border border-slate-200/80 rounded-lg px-3.5 py-2.5 my-3 text-left w-full">
          <div className="text-xs font-semibold text-amber-700 bg-amber-100/70 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
            Next Step
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            {recommendation}
          </p>
        </div>
      )}

      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
          {action && (
            action.href ? (
              <Link
                href={action.href}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 rounded-lg shadow-sm transition-colors"
              >
                {action.icon && <action.icon className="w-3.5 h-3.5" />}
                <span>{action.label}</span>
                <ArrowRight className="w-3.5 h-3.5 ml-0.5 opacity-70" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={action.onClick}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 rounded-lg shadow-sm transition-colors"
              >
                {action.icon && <action.icon className="w-3.5 h-3.5" />}
                <span>{action.label}</span>
                <ArrowRight className="w-3.5 h-3.5 ml-0.5 opacity-70" />
              </button>
            )
          )}

          {secondaryAction && (
            secondaryAction.href ? (
              <Link
                href={secondaryAction.href}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <span>{secondaryAction.label}</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <span>{secondaryAction.label}</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function EmptyStateRow({
  colSpan,
  ...props
}: EmptyStateProps & { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 px-4">
        <EmptyState {...props} />
      </td>
    </tr>
  );
}
