import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { colors } from "@majlis/shared";
import { useApp } from "@/store";

export default function Index() {
  const status = useApp((s) => s.status);
  if (status === "booting")
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  return <Redirect href={status === "ready" ? "/servers" : "/login"} />;
}
