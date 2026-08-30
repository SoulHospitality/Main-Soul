import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import OrChecklistSection from '../components/OrChecklistSection';
import ReservationsNav from '../components/ReservationsNav';
import { usePermissions } from '../hooks/usePermissions';

export default function ReservationsChecklist() {
  const qc = useQueryClient();
  const { isAdmin, isOwnersRelations, canEditOrChecklist } = usePermissions();
  const pageTitle =
    isOwnersRelations && !isAdmin ? 'Reservations' : 'Reservations';

  const { data: reservations = [], isLoading } = useQuery({
    queryKey: ['reservations'],
    queryFn: () => api.get('/reservations').then((r) => r.data),
    refetchInterval: 60000,
  });

  const orChecklistMutation = useMutation({
    mutationFn: ({ id, ...fields }) => api.patch(`/reservations/${id}/or-checklist`, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update checklist'),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">{pageTitle}</h1>
        <p className="page-subtitle">
          Today and tomorrow check-ins — notify owners, collect IDs, and confirm permissions.
        </p>
      </div>

      <ReservationsNav />

      <OrChecklistSection
        reservations={reservations}
        canEdit={canEditOrChecklist}
        savingId={orChecklistMutation.isPending ? orChecklistMutation.variables?.id : null}
        onToggle={(id, field, value) => orChecklistMutation.mutate({ id, [field]: value })}
      />
    </div>
  );
}
