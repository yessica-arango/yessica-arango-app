import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import RegistroCliente from './pages/RegistroCliente'
import Home from './pages/Home'
import RegistroTrabajo from './pages/RegistroTrabajo'
import Dashboard from './pages/Dashboard'
import CierreCaja from './pages/CierreCaja'
import Usuarios from './pages/Usuarios'
import Servicios from './pages/Servicios'
import Citas from './pages/Citas'
import PortalCliente from './pages/PortalCliente'
import Jornada from './pages/Jornada'
import Asistencia from './pages/Asistencia'
import Reportes from './pages/Reportes'
import Permisos from './pages/Permisos'
import Prestamos from './pages/Prestamos'
import MiPerfil from './pages/MiPerfil'
import Historial from './pages/Historial'
import CuentasPorCobrar from './pages/CuentasPorCobrar'
import Productos from './pages/Productos'
import Ventas from './pages/Ventas'
import Contabilidad from './pages/Contabilidad'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/registro-cliente" element={<RegistroCliente />} />

          {/* Portal de la clienta: tiene su propio encabezado, fuera del Layout del personal */}
          <Route
            path="/portal"
            element={
              <ProtectedRoute roles={['cliente']}>
                <PortalCliente />
              </ProtectedRoute>
            }
          />

          {/* Área del personal (con la barra de navegación por rol) */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Home />} />
            <Route
              path="/jornada"
              element={
                <ProtectedRoute roles={['personal', 'admin']}>
                  <Jornada />
                </ProtectedRoute>
              }
            />
            <Route
              path="/registro"
              element={
                <ProtectedRoute roles={['personal']}>
                  <RegistroTrabajo />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute roles={['superadmin']}>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cobros"
              element={
                <ProtectedRoute roles={['admin', 'superadmin']}>
                  <CuentasPorCobrar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/ventas"
              element={
                <ProtectedRoute roles={['admin', 'superadmin']}>
                  <Ventas />
                </ProtectedRoute>
              }
            />
            <Route
              path="/productos"
              element={
                <ProtectedRoute roles={['superadmin']}>
                  <Productos />
                </ProtectedRoute>
              }
            />
            <Route
              path="/contabilidad"
              element={
                <ProtectedRoute roles={['superadmin']}>
                  <Contabilidad />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cierre-caja"
              element={
                <ProtectedRoute roles={['admin', 'superadmin']}>
                  <CierreCaja />
                </ProtectedRoute>
              }
            />
            <Route
              path="/asistencia"
              element={
                <ProtectedRoute roles={['admin', 'superadmin']}>
                  <Asistencia />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reportes"
              element={
                <ProtectedRoute roles={['admin', 'superadmin']}>
                  <Reportes />
                </ProtectedRoute>
              }
            />
            <Route
              path="/usuarios"
              element={
                <ProtectedRoute roles={['superadmin']}>
                  <Usuarios />
                </ProtectedRoute>
              }
            />
            <Route
              path="/servicios"
              element={
                <ProtectedRoute roles={['superadmin']}>
                  <Servicios />
                </ProtectedRoute>
              }
            />
            <Route
              path="/citas"
              element={
                <ProtectedRoute roles={['admin', 'superadmin']}>
                  <Citas />
                </ProtectedRoute>
              }
            />
            <Route
              path="/permisos"
              element={
                <ProtectedRoute roles={['personal', 'admin', 'superadmin']}>
                  <Permisos />
                </ProtectedRoute>
              }
            />
            <Route
              path="/prestamos"
              element={
                <ProtectedRoute roles={['superadmin']}>
                  <Prestamos />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mi-perfil"
              element={
                <ProtectedRoute roles={['personal']}>
                  <MiPerfil />
                </ProtectedRoute>
              }
            />
            <Route
              path="/historial"
              element={
                <ProtectedRoute roles={['superadmin']}>
                  <Historial />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
