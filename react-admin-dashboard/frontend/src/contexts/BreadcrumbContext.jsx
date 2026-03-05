import { createContext, useContext, useState, useCallback } from 'react';

const BreadcrumbContext = createContext({ treePath: [], setTreePath: () => {} });

export function BreadcrumbProvider({ children }) {
  const [treePath, setTreePathState] = useState([]);
  const setTreePath = useCallback((path) => setTreePathState(path || []), []);
  return (
    <BreadcrumbContext.Provider value={{ treePath, setTreePath }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useTreeBreadcrumb() {
  return useContext(BreadcrumbContext);
}
