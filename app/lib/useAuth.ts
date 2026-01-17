import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { isAuthenticated } from "./directus";

/**
 * Hook to protect routes - redirects to /access if not authenticated
 * Validates token on mount
 */
export function useRequireAuth() {
  const navigate = useNavigate();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const authenticated = await isAuthenticated();

      if (!authenticated) {
        navigate("/access");
      }

      setIsChecking(false);
    }

    checkAuth();
  }, [navigate]);

  return !isChecking;
}
