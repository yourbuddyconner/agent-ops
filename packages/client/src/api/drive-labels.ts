import { useQuery } from '@tanstack/react-query';
import { api } from './client';

interface DriveLabel {
  id: string;
  name: string;
  type: string;
}

interface LabelsResponse {
  available: boolean;
  labels?: DriveLabel[];
  reason?: string;
}

export function useDriveLabels() {
  return useQuery({
    queryKey: ['integrations', 'google_workspace', 'labels'],
    queryFn: () => api.get<LabelsResponse>('/integrations/google_workspace/labels'),
  });
}
