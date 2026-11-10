import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
export const colors = { cream: '#F6F3EB', card: '#FFFEFA', ink: '#253C39', muted: '#687671', teal: '#176C60', light: '#E6EEE5', line: '#DDDCD1', red: '#A13C33' };
export const ui = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }, column: { gap: 14 },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 20, padding: 22, gap: 14 },
  title: { color: colors.ink, fontSize: 25, fontWeight: '700', lineHeight: 34 }, subtitle: { color: colors.ink, fontSize: 18, fontWeight: '600', lineHeight: 27 },
  text: { color: colors.ink, fontSize: 15, lineHeight: 24 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  tag: { alignSelf: 'flex-start', backgroundColor: colors.light, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, color: colors.teal, fontSize: 12 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFFFF', borderRadius: 11, paddingHorizontal: 14, paddingVertical: 12, minHeight: 46, color: colors.ink, fontSize: 15 },
  button: { borderRadius: 10, backgroundColor: colors.teal, minHeight: 44, paddingVertical: 11, paddingHorizontal: 17, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.light }, danger: { backgroundColor: '#FAECE6' }, buttonText: { color: 'white', fontWeight: '600', fontSize: 14 },
});
export function Button({ children, onPress, busy, disabled, secondary, danger }: { children: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean; danger?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={children} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [ui.button, secondary && ui.secondary, danger && ui.danger, { opacity: disabled || busy ? 0.45 : pressed ? 0.72 : 1 }]}>{busy ? <ActivityIndicator color={secondary ? colors.teal : 'white'} /> : <Text style={[ui.buttonText, (secondary || danger) && { color: danger ? colors.red : colors.teal }]}>{children}</Text>}</Pressable>; }
export function Field({ label, ...props }: TextInputProps & { label: string }) { return <View style={{ gap: 6 }}><Text style={ui.muted}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#89928B" style={[ui.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }]} {...props} /></View>; }
export function Card({ title, children, note }: { title?: string; children?: React.ReactNode; note?: string }) { return <View style={ui.card}>{title && <Text accessibilityRole="header" style={ui.subtitle}>{title}</Text>}{note && <Text style={ui.muted}>{note}</Text>}{children}</View>; }
export function Empty({ text = '这里还没有记录。把第一件小事留在这里吧。' }: { text?: string }) { return <Text style={[ui.muted, { paddingVertical: 14 }]}>{text}</Text>; }
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) { return <View accessibilityRole="alert" style={[ui.card, { borderColor: '#DCB5A4', backgroundColor: '#FFF3EC' }]}><Text style={[ui.text, { color: colors.red }]}>{message}</Text>{retry && <Button secondary onPress={retry}>重试</Button>}</View>; }
