import { Dialog as DialogPrimitive } from 'bits-ui';
import Body from './dialog-body.svelte';
import Content from './dialog-content.svelte';
import Footer from './dialog-footer.svelte';
import Header from './dialog-header.svelte';

const Root = DialogPrimitive.Root;
const Title = DialogPrimitive.Title;
const Description = DialogPrimitive.Description;
const Close = DialogPrimitive.Close;

export { Body, Close, Content, Description, Footer, Header, Root, Title };
