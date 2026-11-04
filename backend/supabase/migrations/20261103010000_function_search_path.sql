-- Peringatan Security Advisor "Function Search Path Mutable": fungsi ini belum mengunci search_path.
-- Isi fungsi sudah memakai nama lengkap (public.device_state), jadi perilakunya tidak berubah.
alter function public.create_device_state() set search_path = '';
