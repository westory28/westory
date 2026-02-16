import React, { useEffect } from 'react';
import Header from '../common/Header';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentUser, loading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!loading && !currentUser) {
            navigate('/');
        }
    }, [currentUser, loading, navigate]);

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

    return (
        <div className="flex flex-col min-h-screen bg-gray-50">
            <Header />
            <main className="flex-1 w-full">
                {children}
            </main>
        </div>
    );
};

export default MainLayout;
