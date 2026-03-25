import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
    getStudentRankPromotionPreviewEmojiEntries,
    isStudentRankPromotionEligible,
    loadStudentRankPromotionSnapshot,
    readStudentRankPromotionTierCode,
    writeStudentRankPromotionTierCode,
} from '../../lib/pointRankPromotion';
import StudentRankPromotionPopup from './StudentRankPromotionPopup';

interface StudentRankPromotionState {
    rank: Awaited<ReturnType<typeof loadStudentRankPromotionSnapshot>>['rank'];
    effectLevel: 'subtle' | 'standard';
    previewEmojiEntries: Awaited<ReturnType<typeof getStudentRankPromotionPreviewEmojiEntries>>;
}

const StudentRankPromotionController: React.FC = () => {
    const { currentUser, config } = useAuth();
    const location = useLocation();
    const [promotionState, setPromotionState] = useState<StudentRankPromotionState | null>(null);
    const requestSeqRef = useRef(0);

    useEffect(() => {
        const isStudentRoute = location.pathname.startsWith('/student');
        if (!currentUser || !config || !isStudentRoute) {
            setPromotionState(null);
            return;
        }

        let cancelled = false;
        const requestSeq = ++requestSeqRef.current;

        const run = async () => {
            try {
                const snapshot = await loadStudentRankPromotionSnapshot(config, currentUser.uid);
                if (cancelled || requestSeq !== requestSeqRef.current) return;

                const rank = snapshot.rank;
                if (!rank || !rank.enabled) {
                    setPromotionState(null);
                    return;
                }

                const effectLevel = snapshot.policy.rankPolicy.celebrationPolicy?.effectLevel === 'subtle'
                    ? 'subtle'
                    : 'standard';
                const celebrationEnabled = snapshot.policy.rankPolicy.celebrationPolicy?.enabled !== false;
                const currentTierCode = rank.tierCode;
                const storedTierCode = readStudentRankPromotionTierCode(config, currentUser.uid);

                if (!storedTierCode) {
                    writeStudentRankPromotionTierCode(config, currentUser.uid, currentTierCode);
                    setPromotionState(null);
                    return;
                }

                if (!isStudentRankPromotionEligible(snapshot.policy.rankPolicy, storedTierCode, currentTierCode)) {
                    setPromotionState(null);
                    return;
                }

                if (!celebrationEnabled) {
                    writeStudentRankPromotionTierCode(config, currentUser.uid, currentTierCode);
                    setPromotionState(null);
                    return;
                }

                const previewEmojiEntries = getStudentRankPromotionPreviewEmojiEntries(
                    snapshot.policy.rankPolicy,
                    storedTierCode,
                    currentTierCode,
                    effectLevel === 'subtle' ? 3 : 5,
                );

                writeStudentRankPromotionTierCode(config, currentUser.uid, currentTierCode);
                setPromotionState({
                    rank,
                    effectLevel,
                    previewEmojiEntries,
                });
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to load student rank promotion state:', error);
                    setPromotionState(null);
                }
            }
        };

        void run();
        return () => {
            cancelled = true;
        };
    }, [config?.year, config?.semester, currentUser?.uid, location.pathname, location.search]);

    if (!promotionState?.rank) return null;

    return (
        <StudentRankPromotionPopup
            open
            rank={promotionState.rank}
            effectLevel={promotionState.effectLevel}
            previewEmojiEntries={promotionState.previewEmojiEntries}
            onClose={() => setPromotionState(null)}
        />
    );
};

export default StudentRankPromotionController;
