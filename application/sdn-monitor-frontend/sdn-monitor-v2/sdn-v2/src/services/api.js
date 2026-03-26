import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sdn_token')
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.clear()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export const authApi = {
  login:    (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
}

export const usersApi = {
  getAll:     ()      => api.get('/users'),
  getMe:      ()      => api.get('/users/me'),
  getById:    (id)    => api.get(`/users/${id}`),
  update:     (id, d) => api.put(`/users/${id}`, d),
  deactivate: (id)    => api.patch(`/users/${id}/deactivate`),
  activate:   (id)    => api.patch(`/users/${id}/activate`),
  delete:     (id)    => api.delete(`/users/${id}`),
}

export const topologyApi = {
  getSwitches:       () => api.get('/topology/switches'),
  getActiveSwitches: () => api.get('/topology/switches/active'),
  getHosts:          () => api.get('/topology/hosts'),
}

export const metricsApi = {
  getPortMetrics:  (switchId, minutes = 30) =>
    api.get(`/metrics/ports/${switchId}?minutes=${minutes}`),
  getLatestMetric: (switchId, portId) =>
    api.get(`/metrics/ports/${switchId}/${portId}/latest`),
}

export const anomaliesApi = {
  getAll:   (unresolvedOnly = false, severity) =>
    api.get('/anomalies', { params: { unresolvedOnly, severity } }),
  getStats: () => api.get('/anomalies/stats'),
  resolve:  (id, data) => api.patch(`/anomalies/${id}/resolve`, data),
}

export const alertRulesApi = {
  getAll:  ()      => api.get('/alert-rules'),
  create:  (data)  => api.post('/alert-rules', data),
  update:  (id, d) => api.put(`/alert-rules/${id}`, d),
  toggle:  (id)    => api.patch(`/alert-rules/${id}/toggle`),
  delete:  (id)    => api.delete(`/alert-rules/${id}`),
}

export default api
