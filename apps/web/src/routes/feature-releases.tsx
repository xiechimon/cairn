import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError, api } from '../api/client.js';
import { FormField, FormStack } from '../components/form-layout.js';
import { SettingsCard, SettingsRow } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.js';
import { Empty, EmptyHeader, EmptyTitle } from '../components/ui/empty.js';
import { Input } from '../components/ui/input.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

interface FlagRelease {
  key: string;
  released: boolean;
}

interface FlagReleaseList {
  flags: FlagRelease[];
}

const QUERY_KEY = ['feature-flag-releases'] as const;

export function FeatureReleases() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draftKey, setDraftKey] = useState('');
  const keyInputId = useId();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<FlagReleaseList>('/api/flags'),
    retry: false,
  });
  const release = useMutation({
    mutationFn: (key: string) =>
      api.post<FlagRelease>(`/api/flags/${encodeURIComponent(key)}/release`),
    onSuccess: (next) => {
      queryClient.setQueryData<FlagReleaseList>(QUERY_KEY, (previous) => ({
        flags: [...(previous?.flags ?? []).filter((flag) => flag.key !== next.key), next].sort(
          (left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
        ),
      }));
      setDraftKey((previous) => (previous === next.key ? '' : previous));
    },
    onError: (error) => toastError(t('发布失败，请重试。'), error),
  });

  if (query.error instanceof ApiError && query.error.status === 403) return null;

  return (
    <SettingsCard>
      <CardHeader className="py-4">
        <CardTitle>
          <h2>{t('新功能发布')}</h2>
        </CardTitle>
        <CardDescription>{t('发布后对所有成员开启，不能在这里关闭。')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border px-0">
        {query.isPending ? (
          <SettingsRow label={t('加载中…')}>
            <Skeleton className="h-5 w-16" />
          </SettingsRow>
        ) : query.isError ? (
          <SettingsRow label={t('新功能列表加载失败')}>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {t('重试')}
            </Button>
          </SettingsRow>
        ) : query.data.flags.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('还没有登记的新功能')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          query.data.flags.map((flag) => (
            <SettingsRow key={flag.key} label={flag.key} labelClassName="break-all">
              <ToggleSwitch
                aria-label={t('向所有成员发布 {key}', { key: flag.key })}
                checked={flag.released}
                disabled={flag.released || release.isPending}
                onCheckedChange={(checked) => {
                  if (checked && !flag.released && !release.isPending) release.mutate(flag.key);
                }}
              />
            </SettingsRow>
          ))
        )}
        <form
          className="px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!release.isPending && !query.isPending && !query.isError) {
              release.mutate(draftKey);
            }
          }}
        >
          <FormStack>
            <FormField
              label={t('功能标识')}
              htmlFor={keyInputId}
              help={t('输入开发者提供的功能标识。')}
            >
              <Input
                id={keyInputId}
                value={draftKey}
                onChange={(event) => setDraftKey(event.target.value)}
                pattern={String.raw`[a-z][a-z0-9_\-]{0,63}`}
                maxLength={64}
                required
                disabled={release.isPending || query.isPending || query.isError}
              />
            </FormField>
            <Button type="submit" disabled={release.isPending || query.isPending || query.isError}>
              {t('发布新功能')}
            </Button>
          </FormStack>
        </form>
      </CardContent>
    </SettingsCard>
  );
}
