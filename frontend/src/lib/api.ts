//frontend\src\lib\api.ts

import axios from "axios";

// baseURL vacío usa el mismo dominio del sitio (Django)
const api = axios.create({
  baseURL: "",
  withCredentials: true, // envía cookies (sesión del admin)
});

export default api;
