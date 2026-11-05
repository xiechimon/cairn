import { useId } from 'react';
import { FORM_CONTROL_CLS, FormField } from '../components/form-layout.js';
import { SegmentedRadio } from '../components/segmented.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import type { ScheduleDraft, ScheduleTrigger } from './schedule-model.js';

const TRIGGER_LABELS: Record<ScheduleTrigger, string> = {
  once: '单次',
  hourly: '每小时',
  daily: '每天',
  weekdays: 'Weekdays',
  weekly: '每周',
  custom: 'Custom cron',
};
const HOURS = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

export function ScheduleFields({
  value,
  onChange,
  tz,
  disabled = false,
}: {
  value: ScheduleDraft;
  onChange: (value: ScheduleDraft) => void;
  tz: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const cronValid = value.cron.trim().split(/\s+/).length === 5;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="text-ui font-medium text-foreground">{t('频率')}</span>
      <SegmentedRadio
        label={t('频率')}
        value={value.trigger}
        onChange={(trigger) => onChange({ ...value, trigger })}
        options={(['once', 'hourly', 'daily', 'weekdays', 'weekly', 'custom'] as const).map(
          (trigger) => ({ value: trigger, label: t(TRIGGER_LABELS[trigger]), disabled }),
        )}
        className="grid h-auto w-full grid-cols-3 [&_button]:w-full [&_button]:px-2"
      />
      {value.trigger === 'custom' ? (
        <FormField
          label={t('Cron expression')}
          htmlFor={`${id}-cron`}
          help={t('Cron is evaluated by the server in {timezone}.', { timezone: tz })}
        >
          <Input
            id={`${id}-cron`}
            className={`${FORM_CONTROL_CLS} font-mono`}
            value={value.cron}
            disabled={disabled}
            aria-invalid={!cronValid}
            aria-describedby={!cronValid ? `${id}-cron-error` : undefined}
            onChange={(event) => onChange({ ...value, cron: event.target.value })}
          />
          {!cronValid && (
            <span id={`${id}-cron-error`} role="alert" className="text-meta text-destructive">
              {t('Use five cron fields: minute hour day month weekday.')}
            </span>
          )}
        </FormField>
      ) : (
        <>
          {(value.trigger === 'once' || value.trigger === 'weekly') && (
            <FormField
              label={t(value.trigger === 'weekly' ? 'Day to repeat each week' : '日期')}
              htmlFor={`${id}-date`}
            >
              <Input
                type="date"
                id={`${id}-date`}
                className={FORM_CONTROL_CLS}
                value={value.date}
                disabled={disabled}
                onChange={(event) => onChange({ ...value, date: event.target.value })}
              />
            </FormField>
          )}
          <div className="flex items-center gap-2">
            {value.trigger !== 'hourly' && (
              <Select
                value={value.hour}
                onValueChange={(hour) => {
                  if (hour !== null) onChange({ ...value, hour });
                }}
                disabled={disabled}
              >
                <SelectTrigger aria-label={t('时')} className="min-w-14">
                  <SelectValue>{value.hour}</SelectValue>
                </SelectTrigger>
                <SelectContent aria-label={t('时')}>
                  {HOURS.map((hour) => (
                    <SelectItem key={hour} value={hour}>
                      {hour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={value.minute}
              onValueChange={(minute) => {
                if (minute !== null) onChange({ ...value, minute });
              }}
              disabled={disabled}
            >
              <SelectTrigger aria-label={t('分')} className="min-w-14">
                <SelectValue>{value.minute}</SelectValue>
              </SelectTrigger>
              <SelectContent aria-label={t('分')}>
                {MINUTES.map((minute) => (
                  <SelectItem key={minute} value={minute}>
                    {minute}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="min-w-0 break-words text-meta text-content-tertiary">{tz}</span>
          </div>
        </>
      )}
      {(value.trigger === 'custom' ? /^0\s/.test(value.cron.trim()) : value.minute === '00') && (
        <p className="m-0 text-meta text-content-tertiary">
          {t('Runs on the hour may start a few minutes late.')}
        </p>
      )}
      <FormField
        label={t('Saved prompt')}
        htmlFor={`${id}-prompt`}
        help={t('Leave empty to use the thread description.')}
      >
        <Textarea
          id={`${id}-prompt`}
          value={value.prompt}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, prompt: event.target.value })}
          className="max-h-40 min-h-20 text-ui md:text-ui"
        />
      </FormField>
    </div>
  );
}
