import GongsinmoongoWorkspace from "../../components/common/GongsinmoongoWorkspace";
import { useAuth } from "../../contexts/AuthContext";

export default function Gongsinmoongo() {
  const { currentUser, config, authGeneration } = useAuth();
  return (
    <GongsinmoongoWorkspace
      key={`${currentUser?.uid}:${authGeneration}:${config?.year}:${config?.semester}`}
    />
  );
}
