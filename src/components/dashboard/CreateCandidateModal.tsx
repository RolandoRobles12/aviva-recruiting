import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { createCandidate } from '../../services/candidates';
import { sendInvitationEmail } from '../../services/functions';
import { useAuth } from '../../hooks/useAuth';

const schema = z.object({
  firstName: z.string().min(2, 'Mínimo 2 caracteres'),
  lastName: z.string().min(2, 'Mínimo 2 caracteres'),
  email: z.string().email('Correo electrónico inválido'),
  phone: z.string().optional(),
  position: z.string().min(2, 'Escribe el puesto'),
});

type FormData = z.infer<typeof schema>;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateCandidateModal({ isOpen, onClose }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    if (!user) return;
    setLoading(true);
    try {
      const candidate = await createCandidate(data, user.uid);
      await sendInvitationEmail({ candidateId: candidate.id });
      setSuccess(true);
      reset();
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    reset();
    setSuccess(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Nuevo Candidato" size="md">
      {success ? (
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserPlus size={28} className="text-green-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">¡Candidato creado!</h3>
          <p className="text-sm text-gray-500">
            Se envió el enlace de documentación al correo del candidato.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nombre(s) <span className="text-red-500">*</span>
              </label>
              <input
                {...register('firstName')}
                placeholder="Ej. María"
                className="input-field"
              />
              {errors.firstName && (
                <p className="text-xs text-red-500 mt-1">{errors.firstName.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Apellidos <span className="text-red-500">*</span>
              </label>
              <input
                {...register('lastName')}
                placeholder="Ej. García López"
                className="input-field"
              />
              {errors.lastName && (
                <p className="text-xs text-red-500 mt-1">{errors.lastName.message}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Correo electrónico <span className="text-red-500">*</span>
            </label>
            <input
              {...register('email')}
              type="email"
              placeholder="candidato@correo.com"
              className="input-field"
            />
            {errors.email && (
              <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teléfono
            </label>
            <input
              {...register('phone')}
              placeholder="Ej. 5512345678"
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Puesto <span className="text-red-500">*</span>
            </label>
            <input
              {...register('position')}
              placeholder="Ej. Ejecutivo de Ventas"
              className="input-field"
            />
            {errors.position && (
              <p className="text-xs text-red-500 mt-1">{errors.position.message}</p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <p className="text-xs text-blue-700">
              Al crear el candidato, se generará automáticamente un enlace único y se enviará
              un correo de invitación con las instrucciones para subir su documentación.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleClose} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Creando...' : 'Crear y enviar invitación'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
