import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Button, Field, Input, Modal } from './ui';
import { Icon, IconName } from './Icon';

type Tone = 'primary' | 'danger' | 'warning';

interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
  icon?: IconName;
}

interface PromptOptions {
  title: string;
  message?: React.ReactNode;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  suffix?: string;
  multiline?: boolean;
  validate?: (value: string) => string | null;
}

interface AlertOptions {
  title: string;
  message?: React.ReactNode;
  confirmText?: string;
  tone?: Tone;
  icon?: IconName;
}

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  alert: (opts: AlertOptions) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

type Request =
  | ({ id: number; kind: 'confirm'; resolve: (v: boolean) => void } & ConfirmOptions)
  | ({ id: number; kind: 'prompt'; resolve: (v: string | null) => void } & PromptOptions)
  | ({ id: number; kind: 'alert'; resolve: () => void } & AlertOptions);

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const close = useCallback((result: boolean | string | null) => {
    setReq(current => {
      if (!current) return null;
      if (current.kind === 'confirm') current.resolve(Boolean(result));
      else if (current.kind === 'prompt') current.resolve(typeof result === 'string' ? result : null);
      else current.resolve();
      return null;
    });
    setError(null);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: opts =>
        new Promise<boolean>(resolve => {
          seq.current += 1;
          setValue('');
          setError(null);
          setReq({ id: seq.current, kind: 'confirm', resolve, ...opts });
        }),
      prompt: opts =>
        new Promise<string | null>(resolve => {
          seq.current += 1;
          setValue(opts.defaultValue || '');
          setError(null);
          setReq({ id: seq.current, kind: 'prompt', resolve, ...opts });
        }),
      alert: opts =>
        new Promise<void>(resolve => {
          seq.current += 1;
          setValue('');
          setError(null);
          setReq({ id: seq.current, kind: 'alert', resolve, ...opts });
        }),
    }),
    []
  );

  const submit = () => {
    if (!req) return;
    if (req.kind === 'prompt') {
      const trimmed = value.trim();
      if (req.validate) {
        const msg = req.validate(trimmed);
        if (msg) {
          setError(msg);
          return;
        }
      }
      close(trimmed);
    } else if (req.kind === 'confirm') {
      close(true);
    } else {
      close(null);
    }
  };

  const tone: Tone = req && 'tone' in req && req.tone ? req.tone : 'primary';
  const confirmIcon: IconName =
    req && 'icon' in req && req.icon ? req.icon : tone === 'danger' ? 'warning' : 'info';

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal
        open={!!req}
        onClose={() => close(null)}
        title={req?.title || ''}
        icon={confirmIcon}
        width={req?.kind === 'prompt' && req.multiline ? 560 : 460}
        className="dialog-modal"
        footer={
          <>
            {req?.kind !== 'alert' ? (
              <Button variant="ghost" onClick={() => close(null)}>
                {'cancelText' in (req || {}) && (req as any).cancelText ? (req as any).cancelText : '取消'}
              </Button>
            ) : null}
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              onClick={submit}
              autoFocus={req?.kind === 'alert'}
            >
              {(req as any)?.confirmText || (req?.kind === 'alert' ? '知道了' : '确定')}
            </Button>
          </>
        }
      >
        {req?.message ? <div className="dialog-message">{req.message}</div> : null}
        {req?.kind === 'prompt' ? (
          <Field label={req.label} error={error} className="dialog-field">
            {req.multiline ? (
              <textarea
                className="input textarea"
                autoFocus
                rows={5}
                placeholder={req.placeholder}
                value={value}
                onChange={e => setValue(e.target.value)}
              />
            ) : (
              <Input
                autoFocus
                value={value}
                placeholder={req.placeholder}
                suffix={req.suffix}
                invalid={!!error}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            )}
          </Field>
        ) : null}
        {req?.kind === 'prompt' ? (
          <div className="dialog-hint">
            <Icon name="info" size={13} /> 按 Enter 确认，Esc 取消
          </div>
        ) : null}
      </Modal>
    </DialogContext.Provider>
  );
};
