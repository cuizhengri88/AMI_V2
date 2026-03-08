import { useTranslation } from 'react-i18next';

export function usePageText(group: string) {
  const { t } = useTranslation();
  return (key: string, options?: Record<string, unknown>) => t(`page_texts.${group}.${key}`, options);
}
