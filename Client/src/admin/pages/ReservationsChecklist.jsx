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
    onMutate: async ({ id, ...fields }) => {
      await qc.cancelQueries({ queryKey: ['reservations'] });
      const previous = qc.getQueryData(['reservations']);
      qc.setQueryData(['reservations'], (old = []) =>
        old.map((r) => (Number(r.id) === Number(id) ? { ...r, ...fields } : r))
      );
      return { previous };
    },
    onSuccess: (data, { id }) => {
      qc.setQueryData(['reservations'], (old = []) =>
        old.map((r) => (Number(r.id) === Number(id) ? { ...r, ...data } : r))
      );
    },
    onError: (e, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['reservations'], context.previous);
      }
      toast.error(e.response?.data?.error || 'Could not update checklist');
    },
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">{pageTitle}</h1>
        <p className="page-subtitle">
          Notify owners, collect IDs, and confirm permissions.
        </p>
      </div>

      <ReservationsNav />

      <OrChecklistSection
        reservations={reservations}
        canEdit={canEditOrChecklist}
        onToggle={(id, field, value) => orChecklistMutation.mutate({ id, [field]: value })}
      />
    </div>
  );
}
