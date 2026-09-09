import {
  CreateEngagementRequestSchema,
  EngagementKindSchema,
  type CreateEngagementInput,
  type Engagement,
  type EngagementKind,
} from "@stonehush/contracts";
import { Button, cn } from "@stonehush/ui";
import { useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { engagementMutationMessage } from "./errors.js";
import { ENGAGEMENT_KIND_LABELS } from "./format.js";
import { useCreateEngagementMutation } from "./mutations.js";

const KIND_OPTIONS = EngagementKindSchema.options;

interface CreateEngagementDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

interface FormFields {
  authorizationContext: string;
  autoContinueWarnings: boolean;
  description: string;
  kind: EngagementKind;
  name: string;
}

const emptyForm: FormFields = {
  authorizationContext: "",
  autoContinueWarnings: false,
  description: "",
  kind: "ctf",
  name: "",
};

function optionalContext(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function toCreateInput(fields: FormFields): CreateEngagementInput {
  return {
    authorizationContext: optionalContext(fields.authorizationContext),
    autoContinueWarnings: fields.autoContinueWarnings,
    description: optionalContext(fields.description),
    kind: fields.kind,
    name: fields.name.trim(),
  };
}

function fieldError(message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  if (message.includes("leading or trailing")) {
    return "Name cannot start or end with spaces.";
  }
  if (message.includes("between 1 and 120")) {
    return "Name must be between 1 and 120 characters.";
  }
  if (message.includes("at most 4096")) {
    return "This field must be at most 4096 characters.";
  }
  return "Check this field and try again.";
}

export function CreateEngagementDialog({ onOpenChange, open }: CreateEngagementDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const nameId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [fields, setFields] = useState<FormFields>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormFields, string>>>({});
  const createEngagement = useCreateEngagementMutation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      createEngagement.reset();
      setFields(emptyForm);
      setFieldErrors({});
      const returnFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnFocus && document.contains(returnFocus)) {
        returnFocus.focus();
      }
      return;
    }
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createEngagement.isPending) return;
    const input = toCreateInput(fields);
    const parsed = CreateEngagementRequestSchema.safeParse(input);
    if (!parsed.success) {
      const nextErrors: Partial<Record<keyof FormFields, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "name" || key === "description" || key === "authorizationContext") {
          const message = fieldError(issue.message);
          if (message !== undefined) nextErrors[key] = message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    createEngagement.mutate(parsed.data, {
      onSuccess: (engagement: Engagement) => {
        onOpenChange(false);
        void navigate({
          to: "/engagements/$engagementId",
          params: { engagementId: engagement.id },
        });
      },
    });
  };

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!createEngagement.isPending) onOpenChange(false);
      return;
    }
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => !node.hasAttribute("disabled"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const mutationError = createEngagement.isError
    ? engagementMutationMessage(createEngagement.error)
    : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-6">
      <button
        type="button"
        aria-label="Dismiss dialog"
        className="absolute inset-0 bg-black/62"
        onClick={() => {
          if (!createEngagement.isPending) onOpenChange(false);
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-[520px] rounded-[10px] border border-border bg-popover p-5 text-popover-foreground shadow-[0_24px_64px_rgba(0,0,0,0.6)] backdrop-blur-glass"
        data-keybinding-capture=""
        onKeyDown={onDialogKeyDown}
      >
        <p className="m-0 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          New engagement
        </p>
        <h2 id={titleId} className="mt-2 mb-1 text-lg font-semibold tracking-[-0.03em]">
          Start an engagement
        </h2>
        <p id={descriptionId} className="mt-0 mb-4 text-[13px] text-muted-foreground">
          Creates a local engagement record. Targets, recipes, and runs are not available yet.
        </p>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              {...(fieldErrors.name ? { error: fieldErrors.name } : {})}
              htmlFor={nameId}
              label="Name"
            >
              <input
                ref={nameRef}
                id={nameId}
                name="name"
                value={fields.name}
                maxLength={120}
                placeholder="Target lab"
                className={fieldClassName(fieldErrors.name !== undefined)}
                onChange={(event) => setFields((current) => ({ ...current, name: event.target.value }))}
              />
            </Field>
            <Field label="Type" htmlFor={`${nameId}-kind`}>
              <select
                id={`${nameId}-kind`}
                name="kind"
                value={fields.kind}
                className={fieldClassName(false)}
                onChange={(event) =>
                  setFields((current) => ({
                    ...current,
                    kind: event.target.value as EngagementKind,
                  }))
                }
              >
                {KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {ENGAGEMENT_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            {...(fieldErrors.description ? { error: fieldErrors.description } : {})}
            htmlFor={`${nameId}-description`}
            label="Description"
          >
            <textarea
              id={`${nameId}-description`}
              name="description"
              value={fields.description}
              rows={3}
              placeholder="Optional context for this engagement"
              className={cn(fieldClassName(fieldErrors.description !== undefined), "min-h-20 py-2")}
              onChange={(event) =>
                setFields((current) => ({ ...current, description: event.target.value }))
              }
            />
          </Field>
          <Field
            {...(fieldErrors.authorizationContext
              ? { error: fieldErrors.authorizationContext }
              : {})}
            htmlFor={`${nameId}-authorization`}
            label="Authorization context"
          >
            <textarea
              id={`${nameId}-authorization`}
              name="authorizationContext"
              value={fields.authorizationContext}
              rows={3}
              placeholder="Optional authorization notes"
              className={cn(
                fieldClassName(fieldErrors.authorizationContext !== undefined),
                "min-h-20 py-2",
              )}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  authorizationContext: event.target.value,
                }))
              }
            />
          </Field>
          <label className="flex min-h-11 items-start gap-3 text-[13px] text-foreground">
            <input
              type="checkbox"
              name="autoContinueWarnings"
              checked={fields.autoContinueWarnings}
              className="mt-1 size-4 accent-primary"
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  autoContinueWarnings: event.target.checked,
                }))
              }
            />
            <span>Always continue warnings for this engagement</span>
          </label>
          {mutationError && (
            <p className="m-0 text-[13px] text-destructive" role="alert">
              {mutationError}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <Button disabled={createEngagement.isPending} type="submit">
              {createEngagement.isPending ? "Creating" : "Create engagement"}
            </Button>
            <Button
              disabled={createEngagement.isPending}
              type="button"
              variant="quiet"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function Field({
  children,
  error,
  htmlFor,
  label,
}: {
  children: ReactNode;
  error?: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
      {error && (
        <span className="text-destructive" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function fieldClassName(invalid: boolean) {
  return cn(
    "min-h-11 w-full rounded-md border bg-transparent px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8",
    invalid ? "border-destructive" : "border-input",
  );
}
